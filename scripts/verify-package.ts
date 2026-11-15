// Runs the built archive the way Toolbelt does: extracted into a temporary folder with no source
// checkout or node_modules, a fresh data directory initialized by the packaged migration, every
// surface opened, a task created through events, then a clean prepare and shutdown.
import { $ } from "bun";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parsePackageManifest } from "@toolbelt/sdk/package";

const version = JSON.parse(await Bun.file("toolbelt.json").text()).version;
const archive = `artifacts/toolbelt-ontrack-${version}-portable.tar.gz`;
const root = mkdtempSync(join(tmpdir(), "ontrack-package-"));
try {
	const pkg = join(root, "package");
	const data = join(root, "data");
	mkdirSync(pkg);
	mkdirSync(data);
	await $`tar -xzf ${archive} -C ${pkg}`;
	const m = parsePackageManifest(await Bun.file(join(pkg, "toolbelt.json")).json());
	const env = { PATH: "/usr/bin:/bin", HOME: root, TOOLBELT_PLUGIN: m.id, TOOLBELT_PLUGIN_VERSION: m.version, TOOLBELT_DATA_DIR: data, TOOLBELT_PACKAGE_ROOT: pkg };

	const migration = Bun.spawn([process.execPath, join(pkg, "migrate.js")], { cwd: root, env, stdin: "pipe", stdout: "pipe", stderr: "inherit", timeout: 10000 });
	migration.stdin.write(JSON.stringify({ type: "migrate", transactionId: "verify", fromVersion: null, toVersion: m.version, fromSchema: null, toSchema: 1, sourceDir: data, targetDir: data }) + "\n");
	migration.stdin.end();
	if ((await migration.exited) !== 0) throw Error("Packaged migration failed");

	const proc = Bun.spawn([process.execPath, join(pkg, "index.js")], { cwd: root, env, stdin: "pipe", stdout: "pipe", stderr: "inherit", timeout: 10000 });
	const send = (msg: unknown) => proc.stdin.write(JSON.stringify(msg) + "\n");
	send({ type: "hello", protocol: 1, capabilities: ["ui.core", "ui.action-key", "lifecycle"], plugin: { id: m.id }, host: { name: "verify", version: "0.3.5" } });
	const surfaces = [...m.screens.map((s) => `screen:${s.id}`), "quick"];
	const rendered = new Set<string>();
	let buffer = "";
	let step = "ready";
	for await (const bytes of proc.stdout) {
		buffer += new TextDecoder().decode(bytes);
		for (let at; (at = buffer.indexOf("\n")) >= 0; ) {
			const line = buffer.slice(0, at);
			buffer = buffer.slice(at + 1);
			if (!line) continue;
			const msg = JSON.parse(line);
			if (msg.type === "ready" && step === "ready") {
				step = "render";
				for (const surface of surfaces) send({ type: "open", surface });
			}
			if (msg.type === "render") rendered.add(msg.surface);
			if (step === "render" && rendered.size === surfaces.length) {
				step = "create";
				send({ type: "event", surface: "screen:tasks", name: "new-task" });
				send({ type: "event", surface: "screen:tasks", name: "field", payload: { form: "task", field: "name", value: "Packaged task" } });
				send({ type: "event", surface: "screen:tasks", name: "save", payload: { dialog: "task" } });
				send({ type: "prepare", requestId: "verify", reason: "upgrade" });
			}
			if (msg.type === "prepared") {
				if (!msg.ready) throw Error("Expected readiness");
				step = "done";
				send({ type: "shutdown" });
				proc.stdin.end();
			}
		}
	}
	if ((await proc.exited) !== 0 || step !== "done") throw Error(`Package contract failed at ${step}`);
	const saved = JSON.parse(readFileSync(join(data, "ontrack.json"), "utf8"));
	if (saved.labels.length !== 4 || saved.tasks[0]?.name !== "Packaged task") throw Error("Packaged data was not saved");
	console.log("Clean package: migration seed, all surfaces, task creation, prepare and shutdown pass.");
} finally {
	rmSync(root, { recursive: true, force: true });
}
