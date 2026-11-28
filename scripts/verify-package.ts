// Runs the built archive the way Toolbelt does: extracted into a temporary folder with no source
// checkout or node_modules, a fresh data directory initialized by the packaged migration, every
// surface opened for the person, a task created through their events (the save answering with its
// id), then a clean prepare and shutdown.
import { $ } from "bun";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HOST_VERSION } from "@toolbelt/sdk";
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
	send({ type: "hello", protocol: m.protocol, capabilities: m.capabilities.required, plugin: { id: m.id }, host: { name: "verify", version: HOST_VERSION } });
	const event = (id: string, name: string, payload?: unknown) => send({ type: "event", id, surface: "screen:tasks", instance: "person", name, ...(payload !== undefined && { payload }), origin: "person" });
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
			// The handshake declares the Tasks view (search, filters and their arrangement) and every action and form.
			if (msg.type === "hello" && !(msg.declarations?.views?.["screen:tasks"]?.search && msg.declarations.views["screen:tasks"].arrange && msg.declarations.actions?.save?.effect === "write" && msg.declarations.forms?.["task-draft"]?.effect === "view"))
				throw Error("Expected the declarations in the handshake");
			if (msg.type === "result" && msg.error) throw Error(`Event ${msg.id} failed: ${msg.error}`);
			if (msg.type === "ready" && step === "ready") {
				step = "render";
				for (const surface of surfaces) send({ type: "open", surface, instance: "person" });
			}
			if (msg.type === "render") rendered.add(msg.surface);
			if (step === "render" && rendered.size === surfaces.length) {
				step = "create";
				event("open", "new-task");
				event("name", "field", { form: "task-draft", field: "name", value: "Packaged task" });
				event("save", "save", { dialog: "task" });
			}
			if (msg.type === "result" && msg.id === "save") {
				if (msg.data?.task !== 1) throw Error("Expected the new task's id in the save's result");
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
