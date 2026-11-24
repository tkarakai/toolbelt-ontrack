import { afterEach, expect, test } from "bun:test";
import type { Node, PluginMessage } from "@toolbelt/sdk";
import { fakeHost } from "@toolbelt/sdk/testing";
import { addTask, seed, type Data } from "../src/model";
import { ontrack } from "../src/plugin";
import { STATE_ICONS } from "../src/ui";

/** The tests' wait before a selected task reads (the real one is READ_AFTER_MS). */
const READ_MS = 100;
const START = new Date(2026, 10, 14, 12, 0).getTime();
let clock = START;
let host: ReturnType<typeof fakeHost> | undefined;
afterEach(() => {
	host?.close();
	clock = START;
});

const CAPS = ["ui.core", "ui.action-key", "lifecycle", "ui.split-action", "ui.rich-fields", "ui.row-select", "ui.row-reorder", "ui.modifier-keys", "ui.timeline", "ui.row-pane", "ui.composer", "navigate"];

async function start(initial: Data = seed()) {
	const saved: Data[] = [];
	host = fakeHost(ontrack({ load: () => structuredClone(initial), save: (d) => saved.push(structuredClone(d)), now: () => clock, readAfterMs: READ_MS }));
	host.send({ type: "hello", protocol: 1, capabilities: CAPS, plugin: { id: "ontrack" }, host: { name: "test", version: "0.3.9" } });
	await until(() => host!.messages.some((m) => m.type === "ready"));
	for (const surface of ["screen:tasks", "screen:labels", "quick"]) host.send({ type: "open", surface });
	await until(() => !!tree("quick"));
	return { saved, event: (name: string, payload?: unknown, surface = "screen:tasks") => send(surface, name, payload) };
}

async function send(surface: string, name: string, payload?: unknown) {
	const count = host!.messages.length;
	host!.send({ type: "event", surface, name, payload });
	await until(() => host!.messages.length > count, 200).catch(() => {});
}

async function until(check: () => boolean, ms = 2000) {
	const end = Date.now() + ms;
	while (!check()) {
		if (Date.now() > end) throw Error("timed out");
		await Bun.sleep(5);
	}
}

/** Selects a row the way Toolbelt does, without waiting for a reply (selecting renders nothing new). */
const pick = (rowId: string) => host!.send({ type: "event", surface: "screen:tasks", name: "select", payload: { table: "tasks", rowId } });

const tree = (surface: string): any =>
	(host!.messages.filter((m): m is Extract<PluginMessage, { type: "render" }> => m.type === "render" && m.surface === surface).at(-1) as any)?.tree as Node;
const table = () => tree("screen:tasks").children[0];
const rows = () => table().rows as any[];
/** The quick view's task list, under its New task line. */
const quickList = () => tree("quick").children[1];
/** A node of a row's details pane, by id (inside its sections too). */
const paneNode = (rowId: string, id: string): any => {
	const find = (nodes: any[]): any => nodes.map((n) => (n.id === id ? n : n.children ? find(n.children) : undefined)).find(Boolean);
	return find(rows().find((r) => r.id === rowId).pane);
};
/** A row's innermost group: its section, or the group inside Progressing (snoozed, watching). */
const groupOf = (r: any) => (Array.isArray(r.group) ? r.group.at(-1).id : r.group);
const bySection = () => Object.fromEntries(["inbox", "working", "snoozed", "watching", "settled"].map((id) => [id, rows().filter((r) => groupOf(r) === id).map((r) => r.cells.name.text)]));
const lastBadge = () => host!.messages.filter((m) => m.type === "badge").at(-1);
const toasts = () => host!.messages.filter((m: any) => m.type === "toast") as any[];
/** What the latest Undo toast's button sends. */
const undoPayload = () => toasts().filter((t) => t.action?.id === "undo").at(-1).action.payload;

function fixture() {
	const d = seed();
	for (const name of ["Write spec", "Reply to Anna", "Fix login bug"]) addTask(d, { name, due: "", desc: "", labels: {} }, START);
	return d; // Inbox: Fix login bug (#3), Reply to Anna (#2), Write spec (#1)
}

test("creates a task with the rich fields and saves it on top of the Inbox", async () => {
	const { saved, event } = await start();
	expect(table().sections.map((s: any) => s.id)).toEqual(["inbox", "progressing", "settled"]);
	// Progressing holds one declared sub-section per state; Snoozed and Watching keep their own order.
	expect(table().sections[1].sections.map((s: any) => [s.id, s.label, s.order])).toEqual([
		["working", "Working on", undefined],
		["snoozed", "Snoozed", "fixed"],
		["watching", "Watching", "fixed"],
	]);
	expect(table()).toMatchObject({ reorder: true, selectEvents: true, appearance: "document" });
	expect(tree("screen:tasks").actions).toEqual([expect.objectContaining({ id: "new-task", key: "n" })]);
	await event("new-task");
	const fields = tree("screen:tasks").dialog.children[0].fields;
	expect(fields.map((f: any) => [f.id, f.type])).toEqual([["name", "text"], ["state", "select"], ["due", "datetime"], ["labels", "tags"], ["related", "tags"], ["desc", "textarea"]]);
	expect(fields[3].keys.map((k: any) => [k.label, !!k.flag])).toEqual([["Project", false], ["isPersonal", true], ["Priority", false], ["Status", false]]);
	await event("field", { form: "task", field: "name", value: "Ship OnTrack" });
	await event("field", { form: "task", field: "due", value: "2026-11-13" });
	await event("field", { form: "task", field: "labels", value: [{ key: "3", value: "High" }, { key: "2" }] });
	await event("field", { form: "task", field: "desc", value: "# Plan\n\n- ship" });
	await event("save", { dialog: "task" });
	expect(tree("screen:tasks").dialog).toBeUndefined();
	// The list lands on the new task.
	expect(host!.messages.filter((m: any) => m.type === "navigate").at(-1)).toMatchObject({ screen: "tasks", select: "1" });
	expect(saved.at(-1)!.tasks[0]).toMatchObject({ id: 1, name: "Ship OnTrack", due: "2026-11-13", desc: "# Plan\n\n- ship", labels: { 2: true, 3: "High" }, state: "inbox" });
	const row = rows()[0];
	expect(row).toMatchObject({ id: "1", group: "inbox" });
	expect(row.cells.name.tags).toEqual([
		{ text: "isPersonal", color: "violet", tooltip: undefined, shade: undefined },
		// Priority shades its values, strongest first: High is the full color.
		{ text: "High", color: "orange", tooltip: "Priority", shade: 1 },
	]);
	expect(row.cells.due.tone).toBe("danger");
	// The overdue dot sits in the row's leading slot, beside the unread dot, not before the title.
expect(row.dot).toEqual({ color: "danger", label: "Overdue" });
expect(row.cells.name.dot).toBeUndefined();
	expect(row.cells.name.tone).toBe("danger");
	expect(quickList().items.find((i: any) => i.id === "1")).toMatchObject({ dot: { color: "danger", label: "Overdue" }, titleStyle: { color: "danger" } });
	// Overdue counts for the badge.
	expect(lastBadge()).toEqual({ type: "badge", value: 1 });
});

test("start working, done for now, unread until opened", async () => {
	const { event } = await start(fixture());
	await event("work", { rowId: "2" });
	expect(bySection().working).toEqual(["Reply to Anna"]);
	expect(rows().find((r) => r.id === "2").actions).toContain("done");
	expect(quickList().items.find((i: any) => i.id === "2")).toMatchObject({ icon: STATE_ICONS.working, subtitle: "Working on · under a minute" });
	// The table's order (the Inbox, then Working on), one state icon each and no working dot.
	const quick = quickList().items;
	expect(quick.at(-1).id).toBe("2");
	expect(quick.map((i: any) => i.icon)).toEqual([...quick.slice(0, -1).map(() => STATE_ICONS.inbox), STATE_ICONS.working]);
	expect(quick.find((i: any) => i.id === "2").dot).toBeUndefined();
	clock += 25 * 60_000;
	await event("done", { rowId: "2" });
	expect(bySection().inbox[0]).toBe("Reply to Anna");
	const row = rows().find((r) => r.id === "2");
	expect(row).toMatchObject({ unread: true });
	expect(row.cells.name.sub).toBe("Back from Working on");
	expect(row.pane.find((n: any) => n.tone === "muted").text).toContain("25m worked in 1 session");
	expect(row.pane[0]).toMatchObject({ type: "text", text: "New · Back from Working on", tone: "info" });
	expect(lastBadge()).toEqual({ type: "badge", value: 1 });
	// It stays unread for a moment; moving on before then keeps it unread.
	pick("2");
	await Bun.sleep(READ_MS / 4);
	pick("1");
	await Bun.sleep(READ_MS * 2);
	expect(rows().find((r) => r.id === "2").unread).toBe(true);
	pick("2");
	await until(() => !rows().find((r) => r.id === "2").unread);
	expect(rows().find((r) => r.id === "2").unread).toBeUndefined();
	expect(lastBadge()).toEqual({ type: "badge", value: null });
});

test("drag between sections performs the matching transition", async () => {
	const { saved, event } = await start(fixture());
	await event("reorder", { table: "tasks", rowId: "1", section: "working", before: null });
	await event("reorder", { table: "tasks", rowId: "2", section: "settled", before: null });
	expect(bySection()).toEqual({ inbox: ["Fix login bug"], working: ["Write spec"], watching: [], snoozed: [], settled: ["Reply to Anna"] });
	// Progressing has no tasks of its own: rows join the Working on, Snoozed or Watching sub-section.
	expect(rows().find((r) => r.id === "1").group).toBe("working");
	expect(Object.keys(saved.at(-1)!.order)).toEqual(["inbox", "working"]);
	// Dropping into Snoozed asks how long, as Z does; Settled can't be snoozed without P first.
	await event("reorder", { table: "tasks", rowId: "2", section: "snoozed", before: null });
	expect(toasts().at(-1)).toMatchObject({ text: "Reopen it first (P), then snooze it.", tone: "error" });
	await event("reorder", { table: "tasks", rowId: "3", section: "snoozed", before: null });
	expect(tree("screen:tasks").dialog).toMatchObject({ id: "snooze" });
});

test("snooze from the menu, wake on time unread, and the custom snooze dialog", async () => {
	const { event } = await start(fixture());
	const snooze = table().actions.find((a: any) => a.id === "snooze");
	expect(snooze.menu.map((a: any) => a.id)).toEqual(["snooze:3h", "snooze:evening", "snooze:tomorrow", "snooze:monday"]);
	await event("snooze:3h", { rowId: "1" });
	expect(bySection().snoozed).toEqual(["Write spec"]);
	expect(toasts().at(-1)).toMatchObject({ action: { id: "undo", label: "Undo" } });
	clock += 3 * 3_600_000;
	await event("search", { query: "" }); // any event looks at the clock
	expect(bySection().inbox[0]).toBe("Write spec");
	expect(rows().find((r) => r.id === "1")).toMatchObject({ unread: true });
	await event("snooze", { rowId: "2" });
	expect(tree("screen:tasks").dialog.children[0].fields[0]).toMatchObject({ type: "datetime", value: "2026-11-15T09:00" });
	await event("field", { form: "snooze", field: "until", value: "2026-11-16" });
	await event("save", { dialog: "snooze" });
	const row = rows().find((r) => r.id === "2");
	expect(groupOf(row)).toBe("snoozed");
	expect(row.cells.when.at).toBe(new Date(2026, 10, 16, 9, 0).getTime());
});

test("Undo restores what settle, archive and delete changed, but only briefly", async () => {
	const { event } = await start(fixture());
	await event("settle", { rowId: "1" });
	expect(bySection().settled).toEqual(["Write spec"]);
	await event("undo", undoPayload(), "toast");
	expect(bySection().settled).toEqual([]);
	expect(bySection().inbox).toContain("Write spec");
	await event("delete", { rowId: "2" });
	clock += 9_000;
	await event("undo", undoPayload(), "toast");
	expect(toasts().at(-1)).toMatchObject({ text: "Too late to undo.", tone: "error" });
	expect(rows().some((r) => r.id === "2")).toBe(false);
	await event("archive", { rowId: "3" });
	expect(rows().some((r) => r.id === "3")).toBe(false);
	// Archived is a Status value: shown, it's the last group, collapsed and dimmed.
	await event("filter", { filter: "status", values: [] });
	expect(table().sections.at(-1)).toMatchObject({ id: "archived", label: "Archived", collapsed: true, muted: true });
	expect(rows().filter((r) => groupOf(r) === "archived").map((r) => [r.id, r.actions])).toEqual([["3", ["unarchive", "edit", "add-update", "delete"]]]);
	await event("unarchive", { rowId: "3" });
	expect(bySection().inbox[0]).toBe("Fix login bug");
});

test("move up and down with ⌥↑ / ⌥↓ actions", async () => {
	const { event } = await start(fixture());
	expect(table().actions.find((a: any) => a.id === "up").key).toBe("alt+up");
	await event("down", { rowId: "3" });
	expect(bySection().inbox).toEqual(["Reply to Anna", "Fix login bug", "Write spec"]);
	await event("up", { rowId: "1" });
	expect(bySection().inbox).toEqual(["Reply to Anna", "Write spec", "Fix login bug"]);
});

test("relates through the searchable task picker; settling a blocker marks the blocked task unread", async () => {
	const { event } = await start(fixture());
	await event("relate", { rowId: "1" });
	const picker = tree("screen:tasks").dialog.children[0].fields[1];
	expect(picker).toMatchObject({ type: "combobox", id: "to" });
	expect(picker.options.map((o: any) => o.value)).toEqual(["2", "3"]);
	await event("field", { form: "relate", field: "type", value: "blocks" });
	await event("field", { form: "relate", field: "to", value: "3" });
	await event("save", { dialog: "relate" });
	await event("settle", { rowId: "1" });
	expect(rows().find((r) => r.id === "3")).toMatchObject({ unread: true });
	expect(rows().find((r) => r.id === "3").cells.name.sub).toBe("Unblocked: #1 is settled");
});

/** A field of the open label dialog, whichever of its forms holds it. */
const labelField = (id: string) => tree("screen:labels").dialog.children.flatMap((c: any) => c.fields ?? []).find((f: any) => f.id === id);

test("labels use the color field", async () => {
	const { saved, event } = await start();
	await event("new-label", undefined, "screen:labels");
	const color = labelField("color");
	expect(color).toMatchObject({ type: "color", value: "blue" });
	await event("field", { form: "label", field: "name", value: "Area" }, "screen:labels");
	await event("field", { form: "label-color", field: "color", value: "teal" }, "screen:labels");
	await event("save", { dialog: "label" }, "screen:labels");
	expect(saved.at(-1)!.labels.at(-1)).toMatchObject({ name: "Area", color: "teal" });
});

test("Settings has a New button above each table, and labels can shade their values", async () => {
	const { saved, event } = await start();
	const page = tree("screen:labels");
	expect(page.actions).toBeUndefined();
	expect(page.children.map((c: any) => [c.type, c.title, c.actions.map((a: any) => a.id), c.children[0].id])).toEqual([
		["card", "Labels", ["new-label"], "labels"],
		["card", "Relation types", ["new-relation-type"], "relation-types"],
	]);
	await event("new-label", undefined, "screen:labels");
	const shades = () => labelField("shades");
	// Intensity needs two values to shade.
	expect(shades()).toBeUndefined();
	await event("field", { form: "label", field: "name", value: "Effort" }, "screen:labels");
	await event("field", { form: "label-values", field: "values", value: [{ text: "S" }, { text: "M" }, { text: "L" }] }, "screen:labels");
	expect(shades()).toMatchObject({ type: "select", value: "__none" });
	await event("field", { form: "label-color", field: "shades", value: "lightest-first" }, "screen:labels");
	await event("save", { dialog: "label" }, "screen:labels");
	expect(saved.at(-1)!.labels.at(-1)).toMatchObject({ name: "Effort", shades: "lightest-first" });
	expect(saved.at(-1)!.labels.at(-1)!.values.map((v) => v.text)).toEqual(["S", "M", "L"]);
	const values = tree("screen:labels").children[0].children[0].rows.at(-1).cells.values.tags;
	expect(values.map((t: any) => [t.text, t.shade])).toEqual([["S", 0], ["M", 0.5], ["L", 1]]);
	// Back to one color.
	await event("edit-label", { rowId: `l${saved.at(-1)!.labels.at(-1)!.id}` }, "screen:labels");
	expect(shades().value).toBe("lightest-first");
	await event("field", { form: "label-color", field: "shades", value: "__none" }, "screen:labels");
	await event("save", { dialog: "label" }, "screen:labels");
	expect(saved.at(-1)!.labels.at(-1)!.shades).toBeUndefined();
});

test("values typed on a task join the label's list, with colors the editor and pills use", async () => {
	const { saved, event } = await start(fixture());
	await event("new-task");
	await event("field", { form: "task", field: "name", value: "Plant" });
	await event("field", { form: "task", field: "labels", value: [{ key: "1", value: "Garden" }] });
	await event("save", { dialog: "task" });
	const project = saved.at(-1)!.labels[0]!;
	expect(project.values.map((v) => v.text)).toEqual(["Garden"]);
	await event("new-task");
	const keys = tree("screen:tasks").dialog.children[0].fields.find((f: any) => f.id === "labels").keys;
	// Project colors each value; Priority shades one color.
	expect(keys.find((k: any) => k.label === "Project")).toMatchObject({ values: ["Garden"], freeform: true, colors: { Garden: project.values[0]!.color } });
	expect(keys.find((k: any) => k.label === "Priority")).toMatchObject({ values: ["High", "Medium", "Low"], shades: { High: 1, Medium: 0.5, Low: 0 } });
	expect(keys.find((k: any) => k.label === "Priority").colors).toBeUndefined();
	// A label coloring each value has no color of its own: the host shows it a rainbow dot.
	expect(keys.find((k: any) => k.label === "Project").color).toBeUndefined();
	expect(keys.find((k: any) => k.label === "Priority").color).toBeDefined();
	const plant = rows().find((r: any) => r.cells.name.text === "Plant");
	expect(plant.cells.name.tags).toEqual([{ text: "Garden", color: project.values[0]!.color, tooltip: "Project", shade: undefined }]);
});

test("the label editor renames, merges, recolors, reorders and removes values", async () => {
	const d = fixture();
	d.tasks[0]!.labels[3] = "High";
	addTask(d, { name: "Low one", due: "", desc: "", labels: { 3: "Low" } }, START);
	addTask(d, { name: "Medium one", due: "", desc: "", labels: { 3: "Medium" } }, START);
	const { saved, event } = await start(d);
	await event("edit-label", { rowId: "l3" }, "screen:labels");
	const list = () => labelField("values");
	// Counts are per value; dots show only with a color per value.
	expect(list()).toMatchObject({ type: "options", reorder: true, colors: false });
	expect(list().value.map((v: any) => [v.key, v.text, v.count, v.color])).toEqual([
		["v:High", "High", 1, undefined],
		["v:Medium", "Medium", 1, undefined],
		["v:Low", "Low", 1, undefined],
	]);
	await event("field", { form: "label-color", field: "valueColors", value: "each" }, "screen:labels");
	expect(list().colors).toBe(true);
	// Label color and Intensity only apply with one color.
	expect(labelField("shades")).toBeUndefined();
	expect(labelField("color")).toBeUndefined();
	expect(list().value.map((v: any) => v.color)).toEqual(["red", "amber", "sky"]);
	// Low → Urgent (moved to the top, recolored), Medium merged into High, a new value added.
	await event(
		"field",
		{ form: "label-values", field: "values", value: [{ key: "v:Low", text: "Urgent", color: "fuchsia" }, { key: "v:High", text: "High", color: "red" }, { key: "v:Medium", text: "High", color: "amber" }, { text: "Someday", color: "teal" }] },
		"screen:labels",
	);
	expect(list().value.map((v: any) => v.key)).toEqual(["v:Low", "v:High", "v:Medium", "n:1"]);
	await event("save", { dialog: "label" }, "screen:labels");
	const after = saved.at(-1)!;
	const priority = after.labels.find((l) => l.id === 3)!;
	const labelRow = (id: string) => tree("screen:labels").children[0].children[0].rows.find((r: any) => r.id === id);
	expect(labelRow("l3").cells.name.dot).toBe("rainbow");
	expect(labelRow("l2").cells.name.dot).not.toBe("rainbow");
	expect(priority.values).toEqual([
		{ text: "Urgent", color: "fuchsia" },
		{ text: "High", color: "red" },
		{ text: "Someday", color: "teal" },
	]);
	expect(priority.valueColors).toBe(true);
	expect(after.tasks.map((t): unknown => t.labels[3])).toEqual(["High", undefined, undefined, "Urgent", "High"]);
	// Removing a value removes it from its tasks.
	await event("edit-label", { rowId: "l3" }, "screen:labels");
	await event("field", { form: "label-values", field: "values", value: list().value.filter((v: any) => v.text !== "Urgent") }, "screen:labels");
	await event("save", { dialog: "label" }, "screen:labels");
	expect(saved.at(-1)!.tasks.map((t): unknown => t.labels[3])).toEqual(["High", undefined, undefined, undefined, "High"]);
	expect(toasts().at(-1)).toMatchObject({ text: "Saved Priority; 1 task lost its value", action: { id: "undo" } });
	await event("undo", undoPayload(), "toast");
	expect(saved.at(-1)!.tasks.map((t): unknown => t.labels[3])).toEqual(["High", undefined, undefined, "Urgent", "High"]);
});

test("updates: add several from the dialog, edit one with its times, delete with Undo", async () => {
	const { saved, event } = await start(fixture());
	const dialog = () => tree("screen:tasks").dialog;
	const composer = () => dialog().children.find((c: any) => c.type === "form");
	const timeline = () => dialog().children.find((c: any) => c.type === "timeline");
	expect(rows().find((r) => r.id === "2").actions).toContain("add-update");
	await event("add-update", { rowId: "2" });
	expect(dialog()).toMatchObject({ id: "updates", title: "Updates · #2 Reply to Anna" });
	expect(composer()).toMatchObject({ id: "update-new", fields: [{ type: "textarea", id: "text-1", markdown: true, autofocus: true, value: "" }] });
	expect(timeline()).toMatchObject({ entries: [], empty: { title: "No updates yet" } });
	// An empty update is refused in the dialog.
	await event("save", { dialog: "updates" });
	expect(dialog().children[0]).toMatchObject({ type: "text", tone: "danger", text: "Write what happened first." });
	await event("field", { form: "update-new", field: "text-1", value: "Called **Anna**" });
	await event("save", { dialog: "updates" });
	clock += 60 * 60_000;
	// The composer comes back empty under a new id, so it mounts fresh and focused.
	expect(composer().fields[0]).toMatchObject({ id: "text-2", value: "" });
	await event("field", { form: "update-new", field: "text-2", value: "Sent the draft" });
	await event("save", { dialog: "updates" });
	expect(saved.at(-1)!.tasks.find((t) => t.id === 2)!.updates.map((u) => u.text)).toEqual(["Called **Anna**", "Sent the draft"]);
	expect(timeline().entries.map((e: any) => [e.id, e.text])).toEqual([["2", "Sent the draft"], ["1", "Called **Anna**"]]);
	expect(timeline().actions.map((a: any) => [a.id, a.key, a.tone])).toEqual([["edit-update", "e", undefined], ["delete-update", undefined, "destructive"]]);
	// Search finds tasks by their updates.
	await event("search", { query: "draft" });
	expect(rows().map((r) => r.id)).toEqual(["2"]);
	await event("search", { query: "" });

	// E on an entry edits it in place, with both times.
	await event("edit-update", { timeline: "updates", entryId: "1" });
	expect(dialog()).toMatchObject({ title: "Edit update · #2 Reply to Anna", actions: [{ id: "update-back" }, { id: "save", label: "Save update" }] });
	expect(composer().fields.map((f: any) => [f.id, f.type])).toEqual([["edit-text-1", "textarea"], ["edit-added", "datetime"], ["edit-updated", "datetime"]]);
	expect(composer().fields[1].value).toBe("2026-11-14T12:00");
	expect(timeline().selected).toBe("1");
	clock += 60_000;
	await event("field", { form: "update-edit", field: "edit-text-1", value: "Called Anna twice" });
	await event("field", { form: "update-edit", field: "edit-added", value: "2026-11-14T09:15" });
	await event("save", { dialog: "updates" });
	let first = saved.at(-1)!.tasks.find((t) => t.id === 2)!.updates.find((u) => u.id === 1)!;
	expect(first).toMatchObject({ text: "Called Anna twice", added: new Date(2026, 10, 14, 9, 15).getTime(), updated: clock });
	expect(composer().id).toBe("update-new");
	// Times can't run backwards; the error shows in the dialog and nothing changes.
	await event("edit-update", { timeline: "updates", entryId: "1" });
	await event("field", { form: "update-edit", field: "edit-updated", value: "2026-11-14T08:00" });
	await event("save", { dialog: "updates" });
	expect(dialog().children[0]).toMatchObject({ type: "text", text: "Last updated can't be before it was added." });
	await event("update-back", { dialog: "updates" });
	expect(composer().id).toBe("update-new");

	// The drawer shows the updates newest first, under a composer.
	const drawerUpdates = paneNode("2", "updates").children[1];
	expect(drawerUpdates.entries.map((e: any) => [e.id, e.text])).toEqual([["2", "Sent the draft"], ["1", "Called Anna twice"]]);
	expect(paneNode("2", "updates").title).toBe("Updates · 2");
	await event("dialog-close", { dialog: "updates" });
	// Editing from the drawer closes when saved.
	await event("edit-update", { rowId: "2", target: "2" });
	expect(dialog().actions[0]).toMatchObject({ id: "update-back", label: "Discard" });
	await event("field", { form: "update-edit", field: "edit-text-2", value: "Sent the final draft" });
	await event("save", { dialog: "updates" });
	expect(dialog()).toBeUndefined();
	first = saved.at(-1)!.tasks.find((t) => t.id === 2)!.updates.find((u) => u.id === 2)!;
	expect(first.text).toBe("Sent the final draft");

	// Delete offers Undo.
	await event("delete-update", { rowId: "2", target: "2" });
	expect(saved.at(-1)!.tasks.find((t) => t.id === 2)!.updates.map((u) => u.id)).toEqual([1]);
	expect(toasts().at(-1)).toMatchObject({ text: "Deleted an update on #2", action: { id: "undo" } });
	await event("undo", undoPayload(), "toast");
	expect(saved.at(-1)!.tasks.find((t) => t.id === 2)!.updates.map((u) => u.id)).toEqual([1, 2]);
});

test("the due picker and snooze picker get placeholders and presets; descriptions render as Markdown", async () => {
	const d = fixture();
	d.tasks[0]!.desc = "# Plan\n\n- ship";
	const { event } = await start(d);
	await event("new-task");
	const due = tree("screen:tasks").dialog.children[0].fields.find((f: any) => f.id === "due");
	expect(due).toMatchObject({ type: "datetime", value: "", placeholder: "No due date" });
	await event("dialog-close", { dialog: "task" });
	await event("snooze", { rowId: "1" });
	const until = tree("screen:tasks").dialog.children[0].fields[0];
	expect(until.presets.map((p: any) => p.label)).toEqual(["3 hours", "This evening", "Tomorrow 9:00", "Next Monday 9:00"]);
	expect(until.presets[2].value).toBe("2026-11-15T09:00");
	const desc = paneNode("1", "task").fields.find((f: any) => f.id === "desc");
	expect(desc).toMatchObject({ type: "textarea", label: "", value: "# Plan\n\n- ship", markdown: true });
});

test("prepare is always ready because writes are synchronous", async () => {
	await start();
	host!.send({ type: "prepare", requestId: "p", reason: "upgrade" });
	await until(() => host!.messages.some((m) => m.type === "prepared"));
	expect(host!.messages.find((m) => m.type === "prepared")).toEqual({ type: "prepared", requestId: "p", ready: true });
});

test("the drawer edits a task in place: name, status, due, labels, description, updates", async () => {
	const { event, saved } = await start(fixture());
	const form = () => paneNode("1", "task");
	expect(form()).toMatchObject({ type: "form", appearance: "inline" });
	expect(form().fields.map((f: any) => f.id)).toEqual(["name", "state", "due", "labels", "related", "desc"]);
	// The id sits above the title (and before it in the table); when it was made, just above the updates.
	expect(form().fields[0].note).toBe("#1");
	expect(rows().find((r) => r.id === "1").cells.name.prefix).toEqual({ text: "#1" });
	expect(table().columns.map((c: any) => c.key)).toEqual(["name", "due", "when"]);
	const pane = rows().find((r) => r.id === "1").pane;
	const updatesAt = pane.findIndex((n: any) => n.id === "updates");
	expect(pane[updatesAt - 1]).toMatchObject({ type: "text", tone: "muted" });
	expect(pane[updatesAt - 1].text).toStartWith("Created ");
	expect(table().enter).toBe("add-update");
	expect(table().actions.find((a: any) => a.id === "add-update").focus).toBe("update");

	await event("field", { form: "task", field: "name", value: "Call Anna back", rowId: "1" });
	await event("field", { form: "task", field: "due", value: "2026-11-20T17:00", rowId: "1" });
	await event("field", { form: "task", field: "desc", value: "**Soon**", rowId: "1" });
	let task = saved.at(-1)!.tasks.find((t) => t.id === 1)!;
	expect([task.name, task.due, task.desc]).toEqual(["Call Anna back", "2026-11-20T17:00", "**Soon**"]);
	// An empty name is refused, and the task stays as it was.
	await event("field", { form: "task", field: "name", value: " ", rowId: "1" });
	expect(toasts().at(-1)).toMatchObject({ text: "A task needs a name.", tone: "error" });

	// Status moves it through its lifecycle; Snooze asks until when; Settled offers Undo.
	await event("field", { form: "task", field: "state", value: "working", rowId: "1" });
	expect(saved.at(-1)!.tasks.find((t) => t.id === 1)!.state).toBe("working");
	expect(form().fields.find((f: any) => f.id === "state").options[1].label).toStartWith("Working on · since");
	await event("field", { form: "task", field: "state", value: "snoozed", rowId: "1" });
	expect(tree("screen:tasks").dialog.id).toBe("snooze");
	await event("dialog-close", { dialog: "snooze" });
	await event("field", { form: "task", field: "state", value: "settled", rowId: "1" });
	expect(saved.at(-1)!.tasks.find((t) => t.id === 1)!.state).toBe("settled");
	expect(toasts().at(-1)).toMatchObject({ text: "Settled #1", action: { id: "undo" } });
	await event("field", { form: "task", field: "state", value: "inbox", rowId: "1" });
	expect(saved.at(-1)!.tasks.find((t) => t.id === 1)!.state).toBe("inbox");

	// The composer adds updates straight away; editing one in place keeps its added time.
	await event("add-update", { rowId: "1", composer: "update", text: "Left a voicemail" });
	await event("add-update", { rowId: "1", composer: "update", text: "She called back" });
	expect(tree("screen:tasks").dialog).toBeUndefined();
	task = saved.at(-1)!.tasks.find((t) => t.id === 1)!;
	expect(task.updates.map((u) => u.text)).toEqual(["Left a voicemail", "She called back"]);
	await event("edit-update-text", { rowId: "1", timeline: "updates", entryId: String(task.updates[0]!.id), text: "Left two voicemails" });
	expect(saved.at(-1)!.tasks.find((t) => t.id === 1)!.updates[0]!.text).toBe("Left two voicemails");
	// Without text (the drawer can't show), Add update opens the dialog.
	await event("add-update", { rowId: "1" });
	expect(tree("screen:tasks").dialog.id).toBe("updates");
});

test("the quick view adds tasks and updates without the window, and Z asks how long in it", async () => {
	const { event, saved } = await start(fixture());
	expect(tree("quick").children[0]).toMatchObject({ type: "composer", id: "quick-task", single: true, key: "n" });
	await event("quick-task", { composer: "quick-task", text: "Buy stamps" }, "quick");
	const added = saved.at(-1)!.tasks.at(-1)!;
	expect([added.name, added.state]).toEqual(["Buy stamps", "inbox"]);
	expect(toasts().at(-1)).toMatchObject({ text: `Added #${added.id} to the Inbox` });

	const item = quickList().items.find((i: any) => i.id === "1");
	expect(item.actions.map((a: any) => a.id)).toEqual(["work", "add-update", "snooze", "settle"]);
	expect(item.actions[1].input).toBeDefined();
	await event("add-update", { rowId: "1", text: "Asked for a quote" }, "quick");
	expect(quickList().items.find((i: any) => i.id === "1").subtitle).toContain("Asked for a quote");
	// Z asks how long, in the main window, on the task.
	await event("snooze", { rowId: "1" }, "quick");
	expect(host!.messages.filter((m: any) => m.type === "navigate").at(-1)).toMatchObject({ screen: "tasks", select: "1" });
	expect(tree("screen:tasks").dialog.children[0].fields[0]).toMatchObject({ id: "until", value: "2026-11-15T09:00" });
	await event("save", { dialog: "snooze" });
	expect(saved.at(-1)!.tasks.find((t) => t.id === 1)!.state).toBe("snoozed");
	// Z on a snoozed task changes the time, starting from the current one.
	await event("snooze", { rowId: "1" });
	expect(tree("screen:tasks").dialog.children[0].fields[0].value).toBe("2026-11-15T09:00");
});

test("watch a task, see it come back for its check-in with why, and watch it again from the window or quick view", async () => {
	// START is Sat Nov 14 2026, 12:00.
	const { saved, event } = await start(fixture());
	const nov = (day: number, hour = 9) => new Date(2026, 10, day, hour, 0).getTime();
	expect(rows().find((r) => r.id === "1").actions).toContain("watch");
	expect(table().actions.find((a: any) => a.id === "watch")).toMatchObject({ key: "w" });
	await event("watch", { rowId: "1" });
	let dialog = tree("screen:tasks").dialog;
	expect(dialog.id).toBe("watch");
	let fields = dialog.children[0].fields;
	expect(fields.map((f: any) => [f.id, f.value])).toEqual([["on", ""], ["repeat", "week"], ["next", "2026-11-21T09:00"]]);
	expect(fields[0]).toMatchObject({ type: "combobox", freeform: true });
	// Changing the repeat moves the first check-in until it's picked by hand.
	await event("field", { form: "watch", field: "repeat", value: "month" });
	expect(tree("screen:tasks").dialog.children[0].fields[2].value).toBe("2026-12-14T09:00");
	await event("field", { form: "watch", field: "repeat", value: "none" });
	expect(tree("screen:tasks").dialog.children[0].fields.map((f: any) => f.id)).toEqual(["on", "repeat"]);
	await event("field", { form: "watch", field: "repeat", value: "week" });
	await event("field", { form: "watch", field: "next", value: "2026-11-20" });
	await event("field", { form: "watch", field: "repeat", value: "2weeks" });
	await event("field", { form: "watch", field: "on", value: "Cobra team" });
	await event("save", { dialog: "watch" });
	expect(tree("screen:tasks").dialog).toBeUndefined();
	expect(saved.at(-1)!.tasks[0]).toMatchObject({ state: "watching", watch: { on: "Cobra team", every: { n: 2, unit: "week" }, next: nov(20) } });
	expect(toasts().at(-1).text).toMatch(/^Watching #1 · next check-in /);
	let row = rows().find((r) => r.id === "1");
	expect(groupOf(row)).toBe("watching");
	expect(row.cells.name.sub).toBe("Waiting on Cobra team · less than a day · every 2 weeks");
	expect(row.cells.when).toMatchObject({ at: nov(20), icon: STATE_ICONS.watching });
	// In Watching: P back to the Inbox, W change the watch, S settle. No snooze.
	expect(row.actions.slice(0, 3)).toEqual(["unwatch", "watch", "settle"]);
	expect(row.actions).not.toContain("snooze");
	// Changing the watch in Watching isn't a check: the same dialog, without a note.
	await event("watch", { rowId: "1" });
	dialog = tree("screen:tasks").dialog;
	expect(dialog.title).toBe("Watch #1 Write spec");
	expect(dialog.children[0].fields.map((f: any) => f.id)).toEqual(["on", "repeat", "next"]);
	await event("dialog-close", { dialog: "watch" });
	expect(tree("screen:tasks").summary).toBeUndefined();
	expect(paneNode("1", "task").fields[1].options.find((o: any) => o.value === "watching").label).toMatch(/^Watching · next check-in Nov 20/);

	// The check-in comes due: back on top of the Inbox, unread, saying why.
	clock = nov(20);
	await event("search", { query: "" });
	row = rows().find((r) => r.id === "1");
	expect(row).toMatchObject({ group: "inbox", unread: true });
	expect(row.cells.name.sub).toBe("Time to check in · waiting on Cobra team for 5 days · not checked yet · every 2 weeks");
	expect(row.cells.name.marks).toEqual([{ icon: STATE_ICONS.watching, tooltip: "Watching: waiting on Cobra team" }]);
	expect(lastBadge()).toMatchObject({ value: 1 });
	const item = quickList().items.find((i: any) => i.id === "1");
	expect(item.actions.map((a: any) => a.id)).toEqual(["work", "watch", "add-update", "snooze", "settle"]);
	// Back in the Inbox: no stop-watching; W watches it again.
	expect(row.actions.slice(0, 4)).toEqual(["work", "snooze", "watch", "settle"]);

	// W from the quick view opens the main window on the task: a check-in, proposing the next
	// date on schedule (Dec 4, two weeks on), with a note.
	await event("watch", { rowId: "1" }, "quick");
	expect(host!.messages.filter((m: any) => m.type === "navigate").at(-1)).toMatchObject({ screen: "tasks", select: "1" });
	dialog = tree("screen:tasks").dialog;
	expect(dialog).toMatchObject({ title: "Check in · #1 Write spec", actions: [expect.objectContaining({ label: "Keep watching" })] });
	expect(dialog.children[0].fields.map((f: any) => [f.id, f.value])).toEqual([["on", "Cobra team"], ["repeat", "2weeks"], ["next", "2026-12-04T09:00"], ["note", ""]]);
	await event("field", { form: "watch", field: "note", value: "Portal says pending." });
	await event("save", { dialog: "watch" });
	expect(saved.at(-1)!.tasks[0]).toMatchObject({ state: "watching", unread: false, watch: { next: nov(34), anchor: nov(20), checks: 1 } });
	expect(saved.at(-1)!.tasks[0]!.updates.at(-1)!.text).toBe("Checked in: still waiting on Cobra team.\n\nPortal says pending.");
	expect(toasts().at(-1)).toMatchObject({ text: expect.stringMatching(/^Still watching #1 · next check-in /), action: { id: "undo" } });

	// P in Watching: back to the Inbox, an ordinary task again.
	await event("unwatch", { rowId: "1" });
	expect(saved.at(-1)!.tasks[0]).toMatchObject({ state: "inbox" });
	expect(saved.at(-1)!.tasks[0]!.watch).toBeUndefined();
	expect(rows().find((r) => r.id === "1").group).toBe("inbox");
	expect(saved.at(-1)!.tasks[0]).toMatchObject({ unread: true, unreadReason: "Back from Watching" });
	// The drawer's status and a drop into Watching open the Watch dialog too.
	await event("field", { form: "task", field: "state", value: "watching", rowId: "1" });
	expect(tree("screen:tasks").dialog.id).toBe("watch");
	await event("save", { dialog: "watch" });
	// A drop into the Watching sub-section asks the same.
	await event("reorder", { table: "tasks", rowId: "2", section: "watching", before: null });
	expect(tree("screen:tasks").dialog).toMatchObject({ id: "watch", title: "Watch #2 Reply to Anna" });
	await event("save", { dialog: "watch" });
	expect(saved.at(-1)!.tasks[1]).toMatchObject({ state: "watching", watch: { every: { n: 1, unit: "week" }, next: nov(27) } });
	expect(toasts().at(-1).text).toMatch(/^Watching #2 · next check-in /);
});


test("every entry point goes through the state machine: keys, drags, Status and their action lists", async () => {
	const { saved, event } = await start(fixture());
	const actions = (id: string) => rows().find((r) => r.id === id).actions as string[];
	const states = (id: string) => paneNode(id, "task").fields.find((f: any) => f.id === "state").options.map((o: any) => o.value);
	// Inbox: P work, Z, W, S; the Status picker offers the same states.
	expect(actions("1").slice(0, 4)).toEqual(["work", "snooze", "watch", "settle"]);
	expect(states("1")).toEqual(["inbox", "working", "snoozed", "watching", "settled"]);
	// Snoozed: P wake, Z again, W, S; no Working on.
	await event("snooze:tomorrow", { rowId: "1" });
	expect(actions("1").slice(0, 4)).toEqual(["wake", "snooze", "watch", "settle"]);
	expect(states("1")).toEqual(["inbox", "snoozed", "watching", "settled"]);
	// A key, a drag or the Status picker can't jump from Snoozed to Working on.
	for (const send of [
		() => event("work", { rowId: "1" }),
		() => event("reorder", { table: "tasks", rowId: "1", section: "working", before: "2" }),
		() => event("field", { form: "task", field: "state", value: "working", rowId: "1" }),
	]) {
		await send();
		expect(toasts().at(-1)).toMatchObject({ text: "Bring it back to the Inbox first (P), then start working on it.", tone: "error" });
		expect(saved.at(-1)!.tasks[0]!.state).toBe("snoozed");
	}
	// P wakes it, unread; P again starts work.
	await event("wake", { rowId: "1" });
	expect(saved.at(-1)!.tasks[0]).toMatchObject({ state: "inbox", unread: true, unreadReason: "Back from Snoozed" });
	await event("work", { rowId: "1" });
	expect(saved.at(-1)!.tasks[0]).toMatchObject({ state: "working", unread: false });
	// Settled: P reopen, W watch; nothing else.
	await event("settle", { rowId: "1" });
	expect(actions("1").slice(0, 2)).toEqual(["reopen", "watch"]);
	expect(actions("1")).not.toContain("snooze");
	expect(states("1")).toEqual(["inbox", "watching", "settled"]);
	await event("snooze", { rowId: "1" });
	expect(toasts().at(-1)).toMatchObject({ text: "Reopen it first (P), then snooze it.", tone: "error" });
	await event("reopen", { rowId: "1" });
	expect(saved.at(-1)!.tasks[0]).toMatchObject({ state: "inbox", unread: true, unreadReason: "Reopened from Settled" });
});

test("state icons are the plugin's own monochrome SVGs, declared in the manifest", async () => {
	const manifest = await Bun.file("toolbelt.json").json();
	expect(manifest.capabilities.required).toContain("assets");
	for (const [state, ref] of Object.entries(STATE_ICONS)) {
		const name = `state-${state}`;
		expect(ref).toEndWith(`/${name}`);
		const svg = await Bun.file(manifest.assets[name]).text();
		// Toolbelt tints an SVG with the text color only when it uses currentColor.
		expect(svg).toContain("currentColor");
		expect(svg).not.toMatch(/<script|<style|\bon\w+=|href=/i);
	}
});

test("every move offers Undo, whether by key or drag", async () => {
	const { event } = await start(fixture());
	await event("work", { rowId: "1" });
	// ⌘Z presses Undo while its toast shows (ui.toast-key).
	expect(toasts().at(-1)).toMatchObject({ text: "Working on #1", action: { id: "undo", key: "cmd+z" } });
	await event("undo", undoPayload(), "toast");
	expect(bySection().working).toEqual([]);
	// A drag into another section is the same move, with the same Undo.
	// A drop on the Progressing header itself starts work, as a drop into Working on does.
	await event("reorder", { table: "tasks", rowId: "2", section: "progressing", before: null });
	expect(toasts().at(-1)).toMatchObject({ text: "Working on #2", action: { id: "undo" } });
	await event("done", { rowId: "2" });
	expect(toasts().at(-1)).toMatchObject({ text: "#2 back in the Inbox", action: { id: "undo" } });
	await event("undo", undoPayload(), "toast");
	expect(bySection().working).toEqual(["Reply to Anna"]);
	await event("reorder", { table: "tasks", rowId: "2", section: "inbox", before: null });
	expect(toasts().at(-1)).toMatchObject({ text: "#2 back in the Inbox", action: { id: "undo" } });
	// Reordering within a section offers nothing.
	const count = toasts().length;
	await event("reorder", { table: "tasks", rowId: "1", section: "inbox", before: "3" });
	expect(toasts().length).toBe(count);
});

test("Undo reverts only its own change, and never discards a later one", async () => {
	const { saved, event } = await start(fixture());
	await event("settle", { rowId: "1" });
	const first = undoPayload();
	await event("settle", { rowId: "2" });
	// The first toast's Undo can't revert the second settle.
	await event("undo", first, "toast");
	expect(toasts().at(-1)).toMatchObject({ text: "Only the latest change can be undone.", tone: "error" });
	expect(bySection().settled).toHaveLength(2);
	await event("undo", undoPayload(), "toast");
	expect(bySection().settled).toEqual(["Write spec"]);
	// Undo is used up.
	await event("undo", first, "toast");
	expect(bySection().settled).toEqual(["Write spec"]);

	// A change after the settle withdraws its Undo, so the update isn't lost.
	await event("settle", { rowId: "3" });
	await event("add-update", { rowId: "2", text: "Called her" });
	await event("undo", undoPayload(), "toast");
	expect(toasts().at(-1)).toMatchObject({ tone: "error" });
	expect(bySection().settled).toContain("Fix login bug");
	expect(saved.at(-1)!.tasks.find((t) => t.id === 2)!.updates.map((u) => u.text)).toEqual(["Called her"]);
});

test("opening a task keeps the Undo, and Undo keeps it read", async () => {
	const d = fixture();
	d.tasks.find((t) => t.id === 2)!.unread = true;
	const { event } = await start(d);
	await event("settle", { rowId: "1" });
	pick("2");
	await until(() => !rows().find((r) => r.id === "2").unread);
	await event("undo", undoPayload(), "toast");
	expect(bySection().settled).toEqual([]);
	expect(rows().find((r) => r.id === "2").unread).toBeFalsy();
});

test("Undo lasts as long as its toast: eight seconds", async () => {
	const { event } = await start(fixture());
	await event("settle", { rowId: "1" });
	clock += 7_000;
	await event("undo", undoPayload(), "toast");
	expect(bySection().settled).toEqual([]);
});

test("removing a relation, a label or a relation type offers Undo", async () => {
	const { saved, event } = await start(fixture());
	await event("relate", { rowId: "1" });
	await event("field", { form: "relate", field: "type", value: "blocks" });
	await event("field", { form: "relate", field: "to", value: "3" });
	await event("save", { dialog: "relate" });
	const relations = () => saved.at(-1)!.tasks.find((t) => t.id === 1)!.relations ?? [];
	expect(relations()).toHaveLength(1);
	await event("field", { form: "task", field: "related", value: [], rowId: "1" });
	expect(relations()).toHaveLength(0);
	expect(toasts().at(-1)).toMatchObject({ text: "Changed the relations of #1", action: { id: "undo" } });
	await event("undo", undoPayload(), "toast");
	expect(relations()).toHaveLength(1);

	const labels = saved.at(-1)!.labels.length;
	await event("delete-label", { rowId: "l1" }, "screen:labels");
	expect(saved.at(-1)!.labels).toHaveLength(labels - 1);
	expect(toasts().at(-1)).toMatchObject({ text: "Deleted the label “Project”", action: { id: "undo" } });
	await event("undo", undoPayload(), "toast");
	expect(saved.at(-1)!.labels).toHaveLength(labels);

	const types = saved.at(-1)!.relationTypes.length;
	await event("delete-relation-type", { rowId: "rsupersedes" }, "screen:labels");
	expect(saved.at(-1)!.relationTypes).toHaveLength(types - 1);
	expect(toasts().at(-1)).toMatchObject({ text: "Deleted the relation type “Supersedes”", action: { id: "undo" } });
	await event("undo", undoPayload(), "toast");
	expect(saved.at(-1)!.relationTypes).toHaveLength(types);
});

test("filters and grouping are saved, and choosing them leaves a standing Undo", async () => {
	const { saved, event } = await start(fixture());
	await event("settle", { rowId: "1" });
	await event("filter-arrange", { order: ["label:1", "status", "due"], grouped: ["label:1", "status"] });
	await event("filter", { filter: "label:3", values: ["High"] });
	expect(saved.at(-1)!.filters.slice(0, 2).map((f) => [f.id, f.group])).toEqual([["label:1", true], ["status", true]]);
	expect(saved.at(-1)!.filters.find((f) => f.id === "label:3")!.selected).toEqual(["High"]);
	expect(tree("screen:tasks").filters.map((f: any) => [f.id, f.group])).toEqual([["label:1", true], ["status", true], ["due", false], ["label:2", false], ["label:3", false], ["label:4", false]]);
	// Undo still reverts the settle, and keeps the new filters.
	await event("filter", { filter: "label:3", values: [] });
	await event("undo", undoPayload(), "toast");
	expect(rows().find((r) => r.id === "1").actions).toContain("work");
	expect(tree("screen:tasks").filters[0]).toMatchObject({ id: "label:1", group: true });
});

test("Workflow offers Archived and resets to Ongoing; Due and labels offer their buckets and No value", async () => {
	await start(fixture());
	const [status, due, project, personal] = tree("screen:tasks").filters;
	expect(status).toMatchObject({ id: "status", label: "Workflow", group: true, selected: ["inbox", "working", "snoozed", "watching", "settled"], default: { label: "Ongoing" } });
	expect(status.options.map((o: any) => [o.label, o.count])).toEqual([["Inbox", 3], ["Working on", 0], ["Snoozed", 0], ["Watching", 0], ["Settled", 0], ["Archived", 0]]);
	expect(due.options.map((o: any) => o.label)).toEqual(["Overdue", "Today", "Next 6 days", "Later", "Past", "No date"]);
	expect(project.options.at(-1)).toMatchObject({ value: "__none", label: "No Project", count: 3 });
	expect(personal.options.map((o: any) => o.label)).toEqual(["Yes", "No"]);
});

test("a drag into a label's group sets the value, into Status groups moves too, and one Undo reverts both", async () => {
	const { event } = await start(fixture());
	await event("filter-arrange", { order: ["label:3", "status"], grouped: ["label:3", "status"] });
	// Only tasks' groups show; drag #1 from No Priority › Inbox into High › Working on.
	await event("reorder", { table: "tasks", rowId: "1", section: "l3=High/working", before: null });
	const row = () => rows().find((r) => r.id === "1");
	expect(row().group).toBe("l3=High/working");
	// The group's header says High and Working on: the row doesn't repeat them.
	expect(row().cells.name.tags).toEqual([]);
	expect(table().sections.map((s: any) => s.id)).toEqual(["l3=High", "l3=__none"]);
	await event("undo", undoPayload(), "toast");
	expect(row().group).toBe("l3=__none/inbox");
	expect(row().cells.name.tags).toEqual([]);
	// Grouped by Priority alone, each row says its state, as a pill before its labels.
	await event("filter-arrange", { order: ["label:3", "status"], grouped: ["label:3"] });
	expect(row().cells.name.tags).toEqual([{ text: "Inbox", icon: STATE_ICONS.inbox }]);
	await event("filter-arrange", { order: ["status", "label:3"], grouped: ["status"] });
	await event("reorder", { table: "tasks", rowId: "1", section: "inbox", before: null });
	expect(row().cells.name.tags).toEqual([]);
});

test("the drawer's Related field adds and removes relations like labels, with Undo", async () => {
	const { event, saved } = await start(fixture());
	const related = () => paneNode("2", "task").fields.find((f: any) => f.id === "related");
	expect(related().keys.find((k: any) => k.key === "parent").values).not.toContain("#2 Reply to Anna");
	await event("field", { form: "task", field: "related", value: [{ key: "parent", value: "#1 Write spec" }, { key: "relatedTo", value: "#3 Fix login bug" }], rowId: "2" });
	expect(saved.at(-1)!.tasks.find((t) => t.id === 2)!.relations).toEqual([{ task: 1, type: "parent" }, { task: 3, type: "relatedTo" }]);
	// #1 sees #2 as its child, under Child.
	expect(paneNode("1", "task").fields.find((f: any) => f.id === "related").value).toEqual([{ key: "~parent", value: "#2 Reply to Anna" }]);
	// Removed from #1's side, the relation held by #2 goes.
	await event("field", { form: "task", field: "related", value: [], rowId: "1" });
	expect(saved.at(-1)!.tasks.find((t) => t.id === 2)!.relations).toEqual([{ task: 3, type: "relatedTo" }]);
	await event("undo", undoPayload(), "toast");
	expect(related().value).toEqual([{ key: "parent", value: "#1 Write spec" }, { key: "relatedTo", value: "#3 Fix login bug" }]);
	// R goes to the Related field in the drawer.
	expect(table().actions.find((a: any) => a.id === "relate").focus).toBe("related");
});

test("the drawer lists Parent, Children, Blocked by and Blocks, and following one selects that task", async () => {
	const d = family();
	d.tasks.find((t) => t.id === 3)!.relations.push({ task: 2, type: "blocks" });
	d.tasks.find((t) => t.id === 3)!.labels[3] = "High";
	const { event } = await start(d);
	const cards = (rowId: string) => rows().find((r) => r.id === rowId).pane.filter((n: any) => String(n.id).startsWith("rel-"));
	expect(cards("1").map((c: any) => c.title)).toEqual(["Children · 0/2 settled"]);
	const kids = cards("1")[0].children[0];
	expect(kids).toMatchObject({ type: "list", open: { id: "open-task" } });
	expect(kids.items.map((i: any) => i.id)).toEqual(["rel:2", "rel:3"]);
	expect(kids.items[1]).toMatchObject({ title: "Fix login bug", prefix: { text: "#3" }, icon: STATE_ICONS.working, tags: [{ text: "Working on" }, { text: "High" }] });
	expect(cards("3").map((c: any) => c.title)).toEqual(["Parent · 1", "Blocks · 1"]);
	expect(cards("2").map((c: any) => c.title)).toEqual(["Parent · 1", "Blocked by · 1"]);
	// Clicking one goes to that task; so does a Related pill.
	await event("open-task", { list: "rel-parent", item: "rel:1", rowId: "2" });
	expect(host!.messages.filter((m: any) => m.type === "navigate").at(-1)).toMatchObject({ screen: "tasks", select: "1" });
	expect(paneNode("2", "task").fields.find((f: any) => f.id === "related").open).toMatchObject({ id: "open-related" });
	await event("open-related", { form: "task", field: "related", key: "blocks", value: "#2 Reply to Anna", rowId: "3" });
	expect(host!.messages.filter((m: any) => m.type === "navigate").at(-1)).toMatchObject({ screen: "tasks", select: "2" });
	// Hidden by the search: it says so.
	await event("search", { query: "login" });
	await event("open-task", { list: "rel-blocks", item: "rel:2", rowId: "3" });
	expect(toasts().at(-1)).toMatchObject({ text: "#2 is hidden by the search or filters.", tone: "error" });
});

test("Parent and Blocks show they're built in and offer no Delete", async () => {
	await start(fixture());
	const relRows = tree("screen:labels").children[1].children[0].rows;
	const parent = relRows.find((r: any) => r.id === "rparent");
	expect(parent.actions).toEqual(["edit-relation-type"]);
	expect(parent.cells.name.sub).toBe("Makes subtasks");
	expect(relRows.find((r: any) => r.id === "rrelatedTo").actions).toBeUndefined();
});

test("a new task can start in any state and with relations", async () => {
	const { saved, event } = await start(fixture());
	await event("new-task");
	const field = (id: string) => tree("screen:tasks").dialog.children[0].fields.find((f: any) => f.id === id);
	expect(field("state").options.map((o: any) => o.value)).toEqual(["inbox", "working", "snoozed", "watching", "settled"]);
	// Each relation type and its inverse; one parent, several of the rest.
	expect(field("related").keys.slice(0, 2).map((k: any) => [k.key, k.label, !!k.multiple])).toEqual([["parent", "Parent", false], ["~parent", "Child", true]]);
	expect(field("related").keys[0].values).toContain("#2 Reply to Anna");
	await event("field", { form: "task", field: "name", value: "Plan launch" });
	await event("field", { form: "task", field: "state", value: "working" });
	await event("field", { form: "task", field: "related", value: [{ key: "parent", value: "#1 Write spec" }, { key: "~parent", value: "#2 Reply to Anna" }, { key: "~parent", value: "#3 Fix login bug" }] });
	expect(field("related").value).toHaveLength(3);
	await event("save", { dialog: "task" });
	const d = saved.at(-1)!;
	const task = d.tasks.find((t) => t.name === "Plan launch")!;
	expect(task.state).toBe("working");
	expect(task.relations).toEqual([{ task: 1, type: "parent" }]);
	expect(d.tasks.filter((t) => t.relations.some((r) => r.type === "parent" && r.task === task.id)).map((t) => t.id).sort()).toEqual([2, 3]);
	// Snoozed asks when, on the new task.
	await event("new-task");
	await event("field", { form: "task", field: "name", value: "Later" });
	await event("field", { form: "task", field: "state", value: "snoozed" });
	await event("save", { dialog: "task" });
	expect(tree("screen:tasks").dialog).toMatchObject({ id: "snooze" });
});

test("a label's groups show its values as pills; the drawer ends with buttons", async () => {
	const d = fixture();
	d.tasks[0]!.labels[3] = "High";
	const { event } = await start(d);
	expect(table().paneButtons).toBe(true);
	await event("filter-arrange", { order: ["label:3"], grouped: ["label:3"] });
	const high = table().sections.find((s: any) => s.id === "l3=High");
	expect(high.pill).toEqual({ color: "orange", shade: 1 });
	expect(table().sections.find((s: any) => s.id === "l3=__none").pill).toBeUndefined();
});

test("without Workflow grouping every row says its state; an archived one says Archived instead of a mark", async () => {
	const { event } = await start(fixture());
	await event("filter", { filter: "status", values: [] });
	await event("filter-arrange", { order: [], grouped: [] });
	const row = (id: string) => rows().find((r) => r.id === id);
	expect(row("1").cells.name.tags[0]).toEqual({ text: "Inbox", icon: STATE_ICONS.inbox });
	await event("archive", { rowId: "1" });
	expect(row("1").cells.name.tags[0]).toEqual({ text: "Archived", icon: "archive" });
	expect(row("1").cells.name.marks).toBeUndefined();
});

test("a drag into Today sets the due date; into Later it's refused with a hint", async () => {
	const { event } = await start(fixture());
	await event("filter-arrange", { order: ["due", "status"], grouped: ["due"] });
	await event("reorder", { table: "tasks", rowId: "2", section: "d=today", before: null });
	expect(rows().find((r) => r.id === "2").group).toBe("d=today");
	await event("reorder", { table: "tasks", rowId: "2", section: "d=later", before: null });
	expect(toasts().at(-1)).toMatchObject({ text: "Set its due date in the details to move it there.", tone: "error" });
	expect(rows().find((r) => r.id === "2").group).toBe("d=today");
});

test("a drag onto Archived archives; out of it into a state unarchives and moves", async () => {
	const { event } = await start(fixture());
	await event("filter", { filter: "status", values: [] });
	await event("reorder", { table: "tasks", rowId: "3", section: "archived", before: null });
	expect(rows().find((r) => r.id === "3").group).toBe("archived");
	expect(toasts().at(-1)).toMatchObject({ text: "Archived #3" });
	await event("reorder", { table: "tasks", rowId: "3", section: "settled", before: null });
	expect(rows().find((r) => r.id === "3").group).toBe("settled");
});

test("without grouping the list is flat and a filter that would nest past ten levels says so", async () => {
	const d = fixture();
	for (let i = 0; i < 8; i++) d.labels.push({ id: 10 + i, name: `L${i}`, type: "bool", color: "blue", values: [], freeform: false });
	const { event } = await start(d);
	await event("filter-arrange", { order: [], grouped: [] });
	expect(table().sections).toBeUndefined();
	expect(rows().every((r) => r.group === undefined)).toBe(true);
	const ids = tree("screen:tasks").filters.map((f: any) => f.id);
	// Status (2) and eight one-level filters fill the ten levels; the rest can't group.
	await event("filter-arrange", { order: ids, grouped: ids.slice(0, 9) });
	expect(tree("screen:tasks").filters.filter((f: any) => f.groupDisabled).map((f: any) => f.groupDisabled)).toEqual(Array(ids.length - 9).fill("Grouping goes 10 levels deep at most"));
	await event("filter-arrange", { order: ids, grouped: ids });
	expect(toasts().at(-1)).toMatchObject({ text: "Grouping goes 10 levels deep at most.", tone: "error" });
});

/** #1 is the parent of #2 and #3; #3 is being worked on. */
function family() {
	const d = fixture();
	d.tasks.find((t) => t.id === 2)!.relations.push({ task: 1, type: "parent" });
	d.tasks.find((t) => t.id === 3)!.relations.push({ task: 1, type: "parent" });
	d.tasks.find((t) => t.id === 3)!.state = "working";
	d.order.inbox = d.order.inbox.filter((x) => x !== 3);
	d.order.working = [3];
	return d;
}
/** Each row as [id, group, context, child ids], nested rows included. */
const shape = (list: any[]): any[] => list.map((r) => [r.id, r.group ?? null, r.context ?? null, r.children ? shape(r.children) : []]);

test("Subtasks is a choice after the filters; off, every task is a row of its own", async () => {
	const { saved, event } = await start(family());
	const control = tree("screen:tasks").controls[0];
	expect(control).toMatchObject({ type: "choice", id: "subtasks", label: "Subtasks", value: "off" });
	expect(control.options.map((o: any) => [o.value, o.section ?? null])).toEqual([["off", null], ["own", "Subtask hierarchy"], ["parent", "Subtask hierarchy"]]);
	expect(rows().map((r) => r.id).sort()).toEqual(["1", "2", "3"]);
	await event("field", { form: "subtasks", field: "subtasks", value: "own" });
	expect(saved.at(-1)!.subtasks).toBe("own");
	expect(table().reorderOnto).toBe("Make it a subtask");
});

test("staying in their own group, a parent elsewhere shows dimmed above its subtasks", async () => {
	const d = family();
	d.subtasks = "own";
	await start(d);
	expect(shape(rows())).toEqual([
		["1", "inbox", null, [["2", null, null, []]]],
		["c1@working", "working", "1", [["3", null, null, []]]],
	]);
	// The parent says how far along its subtasks are.
	expect(rows()[0].cells.name.tags.at(-1)).toMatchObject({ text: "0/2" });
	// The context row acts as the task itself: the table lets it be selected, and it carries the
	// task's actions and drawer (its events come back naming #1).
	expect(table().contextSelect).toBe(true);
	expect(rows()[1].actions).toEqual(rows()[0].actions.filter((a: string) => a !== "indent"));
	expect(rows()[1].pane).toEqual(rows()[0].pane);
	// The context row says the parent's state as a pill, like a subtask following its parent.
	expect(rows()[1].cells.name.tags.map((t: any) => t.text)).toEqual(["Inbox", "0/2"]);
	expect(rows()[1].cells.name.sub).toBeUndefined();
});

test("following their parent, the family sits with it and subtasks say their own state", async () => {
	const d = family();
	d.subtasks = "parent";
	await start(d);
	expect(shape(rows())).toEqual([["1", "inbox", null, [["2", null, null, []], ["3", null, null, []]]]]);
	expect(rows()[0].children[1].cells.name.tags[0]).toMatchObject({ text: "Working on" });
	// #2 is in the Inbox like its group: nothing to say.
	expect(rows()[0].children[0].cells.name.tags).toEqual([]);
});

test("⌥→ goes under the task above, ⌥← moves out, a drop onto a task nests it, each with Undo", async () => {
	const d = fixture();
	d.subtasks = "own";
	await start(d);
	const { event } = { event: (n: string, p?: unknown, s = "screen:tasks") => send(s, n, p) };
	// Inbox: #3, #2, #1. #2 goes under #3.
	const two = () => rows().flatMap((r) => [r, ...(r.children ?? [])]).find((r: any) => r.id === "2");
	expect(two().targets.indent).toEqual([{ id: "3", label: "Under #3 Fix login bug", icon: "indent-increase" }]);
	await event("indent", { rowId: "2", target: "3" });
	expect(shape(rows())).toEqual([["3", "inbox", null, [["2", null, null, []]]], ["1", "inbox", null, []]]);
	expect(two().actions).toContain("outdent");
	await event("outdent", { rowId: "2" });
	expect(rows().map((r) => r.id)).toEqual(["3", "2", "1"]);
	await event("reorder", { table: "tasks", rowId: "1", section: "inbox", before: null, onto: "2" });
	expect(shape(rows())).toEqual([["3", "inbox", null, []], ["2", "inbox", null, [["1", null, null, []]]]]);
	await event("undo", undoPayload(), "toast");
	expect(rows().map((r) => r.id)).toEqual(["3", "2", "1"]);
	// No cycles.
	await event("indent", { rowId: "2", target: "3" });
	await event("reorder", { table: "tasks", rowId: "3", section: "inbox", before: null, onto: "2" });
	expect(toasts().at(-1)).toMatchObject({ text: "That would make a task its own ancestor.", tone: "error" });
});
