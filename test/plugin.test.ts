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
		["working", "Working on it", undefined],
		["snoozed", "Snoozed", "fixed"],
		["watching", "Watching", "fixed"],
	]);
	expect(table()).toMatchObject({ reorder: true, selectEvents: true, appearance: "document" });
	expect(tree("screen:tasks").actions).toEqual([expect.objectContaining({ id: "new-task", key: "n" })]);
	await event("new-task");
	const fields = tree("screen:tasks").dialog.children[0].fields;
	expect(fields.map((f: any) => f.type)).toEqual(["text", "datetime", "tags", "textarea"]);
	expect(fields[2].keys.map((k: any) => [k.label, !!k.flag])).toEqual([["Project", false], ["isPersonal", true], ["Priority", false], ["Status", false]]);
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
	expect(row.cells.name.dot).toEqual({ color: "danger", label: "Overdue" });
	expect(row.cells.name.tone).toBe("danger");
	// Overdue counts for the badge.
	expect(lastBadge()).toEqual({ type: "badge", value: 1 });
});

test("start working, done for now, unread until opened", async () => {
	const { event } = await start(fixture());
	await event("work", { rowId: "2" });
	expect(bySection().working).toEqual(["Reply to Anna"]);
	expect(rows().find((r) => r.id === "2").actions).toContain("done");
	expect(quickList().items.find((i: any) => i.id === "2")).toMatchObject({ icon: STATE_ICONS.working, subtitle: "Working on it · under a minute" });
	// The table's order (the Inbox, then Working on it), one state icon each and no working dot.
	const quick = quickList().items;
	expect(quick.at(-1).id).toBe("2");
	expect(quick.map((i: any) => i.icon)).toEqual([...quick.slice(0, -1).map(() => STATE_ICONS.inbox), STATE_ICONS.working]);
	expect(quick.find((i: any) => i.id === "2").dot).toBeUndefined();
	clock += 25 * 60_000;
	await event("done", { rowId: "2" });
	expect(bySection().inbox[0]).toBe("Reply to Anna");
	const row = rows().find((r) => r.id === "2");
	expect(row).toMatchObject({ unread: true });
	expect(row.cells.name.sub).toBe("Back from Working on it");
	expect(row.pane.find((n: any) => n.tone === "muted").text).toContain("25m worked in 1 session");
	expect(row.pane[0]).toMatchObject({ type: "text", text: "New · Back from Working on it", tone: "info" });
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
	// Progressing has no tasks of its own: rows join the Working on it, Snoozed or Watching sub-section.
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
	await event("field", { form: "show", field: "show", value: "archived" });
	expect(table().id).toBe("archived");
	expect(table().sections).toBeUndefined();
	expect(rows().map((r) => [r.id, r.actions])).toEqual([["3", ["unarchive", "edit", "add-update", "delete"]]]);
	await event("unarchive", { rowId: "3" });
	await event("field", { form: "show", field: "show", value: "active" });
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

test("labels use the color field", async () => {
	const { saved, event } = await start();
	await event("new-label", undefined, "screen:labels");
	const color = tree("screen:labels").dialog.children[0].fields.find((f: any) => f.id === "color");
	expect(color).toMatchObject({ type: "color", value: "blue" });
	await event("field", { form: "label", field: "name", value: "Area" }, "screen:labels");
	await event("field", { form: "label", field: "color", value: "teal" }, "screen:labels");
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
	const shades = () => tree("screen:labels").dialog.children[0].fields.find((f: any) => f.id === "shades");
	expect(shades()).toMatchObject({ type: "select", value: "__none" });
	await event("field", { form: "label", field: "name", value: "Effort" }, "screen:labels");
	await event("field", { form: "label", field: "values", value: "S, M, L" }, "screen:labels");
	await event("field", { form: "label", field: "shades", value: "lightest-first" }, "screen:labels");
	await event("save", { dialog: "label" }, "screen:labels");
	expect(saved.at(-1)!.labels.at(-1)).toMatchObject({ name: "Effort", values: ["S", "M", "L"], shades: "lightest-first" });
	const values = tree("screen:labels").children[0].children[0].rows.at(-1).cells.values.tags;
	expect(values.map((t: any) => [t.text, t.shade])).toEqual([["S", 0], ["M", 0.5], ["L", 1]]);
	// Back to one color.
	await event("edit-label", { rowId: `l${saved.at(-1)!.labels.at(-1)!.id}` }, "screen:labels");
	expect(shades().value).toBe("lightest-first");
	await event("field", { form: "label", field: "shades", value: "__none" }, "screen:labels");
	await event("save", { dialog: "label" }, "screen:labels");
	expect(saved.at(-1)!.labels.at(-1)!.shades).toBeUndefined();
});

test("free-text labels suggest the values other tasks already use", async () => {
	const d = fixture();
	d.tasks[0]!.labels[1] = "Toolbelt";
	d.tasks[1]!.labels[1] = "Garden";
	const { event } = await start(d);
	await event("new-task");
	const keys = tree("screen:tasks").dialog.children[0].fields.find((f: any) => f.id === "labels").keys;
	expect(keys.find((k: any) => k.label === "Project")).toMatchObject({ values: ["Garden", "Toolbelt"], freeform: true });
	expect(keys.find((k: any) => k.label === "Priority")).toMatchObject({ values: ["High", "Medium", "Low"], shades: { High: 1, Medium: 0.5, Low: 0 } });
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
	expect(form().fields.map((f: any) => f.id)).toEqual(["name", "state", "due", "labels", "desc"]);
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
	expect(form().fields.find((f: any) => f.id === "state").options[1].label).toStartWith("Working on it · since");
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
	expect(tree("screen:tasks").summary).toBe("2 open · 1 watching");
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
	// Snoozed: P wake, Z again, W, S; no Working on it.
	await event("snooze:tomorrow", { rowId: "1" });
	expect(actions("1").slice(0, 4)).toEqual(["wake", "snooze", "watch", "settle"]);
	expect(states("1")).toEqual(["inbox", "snoozed", "watching", "settled"]);
	// A key, a drag or the Status picker can't jump from Snoozed to Working on it.
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
	// A drop on the Progressing header itself starts work, as a drop into Working on it does.
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
	await event("unrelate", { rowId: "1", target: "1:blocks:3" });
	expect(relations()).toHaveLength(0);
	expect(toasts().at(-1)).toMatchObject({ text: "Removed the relation between #1 and #3", action: { id: "undo" } });
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
