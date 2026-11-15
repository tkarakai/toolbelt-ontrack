import { afterEach, expect, test } from "bun:test";
import type { Node, PluginMessage } from "@toolbelt/sdk";
import { fakeHost } from "@toolbelt/sdk/testing";
import { seed, type Data } from "../src/model";
import { ontrack } from "../src/plugin";

const NOW = new Date(2026, 10, 14, 12, 0).getTime();
let host: ReturnType<typeof fakeHost> | undefined;
afterEach(() => host?.close());

async function start(initial: Data = seed()) {
	const saved: Data[] = [];
	host = fakeHost(ontrack({ load: () => structuredClone(initial), save: (d) => saved.push(structuredClone(d)), now: () => NOW }));
	host.send({ type: "hello", protocol: 1, capabilities: ["ui.core", "ui.action-key", "lifecycle"], plugin: { id: "ontrack" }, host: { name: "test", version: "0.3.5" } });
	await until(() => host!.messages.some((m) => m.type === "ready"));
	for (const surface of ["screen:tasks", "screen:labels", "quick"]) host.send({ type: "open", surface });
	await until(() => !!tree("quick"));
	return { saved, event: (name: string, payload?: unknown, surface = "screen:tasks") => send(surface, name, payload) };
}

async function send(surface: string, name: string, payload?: unknown) {
	const count = host!.messages.length;
	host!.send({ type: "event", surface, name, payload });
	await until(() => host!.messages.length > count || false, 200).catch(() => {});
}

async function until(check: () => boolean, ms = 2000) {
	const end = Date.now() + ms;
	while (!check()) {
		if (Date.now() > end) throw Error("timed out");
		await Bun.sleep(5);
	}
}

const tree = (surface: string): any =>
	(host!.messages.filter((m): m is Extract<PluginMessage, { type: "render" }> => m.type === "render" && m.surface === surface).at(-1) as any)?.tree as Node;
const rows = () => tree("screen:tasks").children[0].rows;

test("creates a task through the dialog and saves it", async () => {
	const { saved, event } = await start();
	expect(tree("screen:tasks").children[0].empty.title).toBe("No tasks yet");
	await event("new-task");
	expect(tree("screen:tasks").dialog.title).toBe("New task");
	expect(tree("screen:labels").dialog).toBeUndefined();
	await event("field", { form: "task", field: "name", value: "Ship OnTrack" });
	await event("field", { form: "task", field: "due", value: "2026-11-13" });
	await event("field", { form: "task", field: "label:3", value: "High" });
	await event("field", { form: "task", field: "label:2", value: true });
	await event("save", { dialog: "task" });
	expect(tree("screen:tasks").dialog).toBeUndefined();
	expect(saved.at(-1)!.tasks).toEqual([{ id: 1, name: "Ship OnTrack", created: NOW, updated: NOW, due: "2026-11-13", desc: "", labels: { 2: true, 3: "High" }, relations: [] }]);
	const row = rows()[0];
	expect(row.cells.name.tags).toEqual([
		{ text: "isPersonal", color: "violet", tooltip: undefined },
		{ text: "High", color: "orange", tooltip: "Priority" },
	]);
	expect(row.cells.due.tone).toBe("danger");
	expect(host!.messages.filter((m) => m.type === "badge").at(-1)).toEqual({ type: "badge", value: 1 });
	expect(tree("quick").items[0]).toMatchObject({ id: "1", title: "Ship OnTrack", dot: "danger" });
});

test("invalid input keeps the dialog open with the error and changes nothing", async () => {
	const { saved, event } = await start();
	await event("new-task");
	await event("field", { form: "task", field: "name", value: "x" });
	await event("field", { form: "task", field: "due", value: "tomorrow" });
	await event("save", { dialog: "task" });
	expect(tree("screen:tasks").dialog.children[0]).toMatchObject({ type: "text", tone: "danger" });
	expect(saved).toEqual([]);
	await event("dialog-close", { dialog: "task" });
	expect(tree("screen:tasks").dialog).toBeUndefined();
});

test("relates, filters, searches and hides done tasks", async () => {
	const data = seed();
	data.tasks = [
		{ id: 1, name: "Epic", created: 0, updated: 0, desc: "", labels: { 4: "Todo" }, relations: [] },
		{ id: 2, name: "Step", created: 0, updated: 0, desc: "**bold**", labels: { 4: "Done" }, relations: [] },
	];
	data.nextTaskId = 3;
	const { saved, event } = await start(data);
	expect(rows().map((r: any) => r.id)).toEqual(["1"]);
	await event("field", { form: "show", field: "show", value: "all" });
	expect(rows().map((r: any) => r.id)).toEqual(["1", "2"]);
	await event("relate", { rowId: "1" });
	await event("field", { form: "relate", field: "type", value: "~parent" });
	await event("field", { form: "relate", field: "to", value: "2" });
	await event("save", { dialog: "relate" });
	expect(saved.at(-1)!.tasks[1]!.relations).toEqual([{ task: 1, type: "parent" }]);
	const epic = rows()[0];
	expect(epic.details.find((d: any) => d.section === "Related tasks")).toMatchObject({ label: "Child", value: "#2 Step" });
	expect(epic.targets.unrelate).toEqual([{ id: "2:parent:1", label: "Child #2 Step", icon: "link" }]);
	await event("filter", { filter: "label:4", values: ["Done"] });
	expect(rows().map((r: any) => r.id)).toEqual(["2"]);
	await event("filter", { filter: "label:4", values: [] });
	await event("search", { query: "epic" });
	expect(rows().map((r: any) => r.id)).toEqual(["1"]);
	await event("unrelate", { rowId: "1", target: "2:parent:1" });
	expect(saved.at(-1)!.tasks[1]!.relations).toEqual([]);
});

test("manages labels and relation types from the Labels screen", async () => {
	const { saved, event } = await start();
	await event("new-label", undefined, "screen:labels");
	expect(tree("screen:labels").dialog.title).toBe("New label");
	expect(tree("screen:tasks").dialog).toBeUndefined();
	await event("field", { form: "label", field: "name", value: "Area" }, "screen:labels");
	await event("field", { form: "label", field: "values", value: "Home, Work" }, "screen:labels");
	await event("field", { form: "label", field: "color", value: "teal" }, "screen:labels");
	await event("save", { dialog: "label" }, "screen:labels");
	expect(saved.at(-1)!.labels.at(-1)).toEqual({ id: 5, name: "Area", type: "string", color: "teal", values: ["Home", "Work"], freeform: false });
	await event("delete-label", { rowId: "l1" }, "screen:labels");
	expect(saved.at(-1)!.labels.map((l) => l.name)).toEqual(["isPersonal", "Priority", "Status", "Area"]);
	await event("edit-relation-type", { rowId: "rblocks" }, "screen:labels");
	await event("field", { form: "relationType", field: "inverse", value: "Waits on" }, "screen:labels");
	await event("save", { dialog: "relationType" }, "screen:labels");
	expect(saved.at(-1)!.relationTypes.find((t) => t.id === "blocks")).toEqual({ id: "blocks", name: "Blocks", inverse: "Waits on" });
});

test("prepare is always ready because writes are synchronous", async () => {
	await start();
	host!.send({ type: "prepare", requestId: "p", reason: "upgrade" });
	await until(() => host!.messages.some((m) => m.type === "prepared"));
	expect(host!.messages.find((m) => m.type === "prepared")).toEqual({ type: "prepared", requestId: "p", ready: true });
});
