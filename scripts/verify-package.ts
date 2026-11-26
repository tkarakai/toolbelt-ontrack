// Runs the built archive the way Toolbelt does: extracted into a temporary folder with no source
// checkout or node_modules, a fresh data directory initialized by the packaged migration, every
// surface opened for the person, a task created through their events, then a clean prepare and
// shutdown.
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
	migration.stdin.write(JSON.stringify({ type: "migrate", transactionId: "verify", fromVersion: null, toVersion: m.version, fromSchema: null, toSchema: m.data.schema, sourceDir: data, targetDir: data }) + "\n");
	migration.stdin.end();
	if ((await migration.exited) !== 0) throw Error("Packaged migration failed");

	const proc = Bun.spawn([process.execPath, join(pkg, "index.js")], { cwd: root, env, stdin: "pipe", stdout: "pipe", stderr: "inherit", timeout: 10000 });
	const send = (msg: unknown) => proc.stdin.write(JSON.stringify(msg) + "\n");
	send({ type: "hello", protocol: 2, capabilities: m.capabilities.required, plugin: { id: m.id }, host: { name: "verify", version: "0.6.0" } });
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
			// The Tasks screen declares its view (search, filters and their arrangement) in the handshake.
			if (msg.type === "hello" && !(msg.views?.["screen:tasks"]?.search && msg.views["screen:tasks"].arrange)) throw Error("Expected the Tasks view declaration");
			if (msg.type === "ready" && step === "ready") {
				step = "render";
				for (const surface of surfaces) send({ type: "open", surface, instance: "person" });
			}
			if (msg.type === "render") rendered.add(msg.surface);
			if (step === "render" && rendered.size === surfaces.length) {
				step = "create";
				send({ type: "event", surface: "screen:tasks", instance: "person", name: "new-task" });
				send({ type: "event", surface: "screen:tasks", instance: "person", name: "field", payload: { form: "task", field: "name", value: "Packaged task" } });
				send({ type: "event", surface: "screen:tasks", instance: "person", name: "save", payload: { dialog: "task" } });
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
