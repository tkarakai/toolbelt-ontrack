import { afterEach, expect, test } from "bun:test";
import type { Node, PluginMessage } from "@toolbelt/sdk";
import { fakeHost } from "@toolbelt/sdk/testing";
import { addTask, seed, type Data } from "../src/model";
import { ontrack } from "../src/plugin";

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
	host = fakeHost(ontrack({ load: () => structuredClone(initial), save: (d) => saved.push(structuredClone(d)), now: () => clock }));
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

function fixture() {
	const d = seed();
	for (const name of ["Write spec", "Reply to Anna", "Fix login bug"]) addTask(d, { name, due: "", desc: "", labels: {} }, START);
	return d; // Inbox: Fix login bug (#3), Reply to Anna (#2), Write spec (#1)
}

test("creates a task with the rich fields and saves it on top of the Inbox", async () => {
	const { saved, event } = await start();
	expect(table().sections.map((s: any) => s.id)).toEqual(["inbox", "working", "settled"]);
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
	// Overdue counts for the badge.
	expect(lastBadge()).toEqual({ type: "badge", value: 1 });
});

test("start working, done for now, unread until opened", async () => {
	const { event } = await start(fixture());
	await event("start", { rowId: "2" });
	expect(bySection().working).toEqual(["Reply to Anna"]);
	expect(rows().find((r) => r.id === "2").actions).toContain("done");
	expect(quickList().items[0]).toMatchObject({ id: "2", icon: "play", subtitle: "Progressing · under a minute" });
	clock += 25 * 60_000;
	await event("done", { rowId: "2" });
	expect(bySection().inbox[0]).toBe("Reply to Anna");
	const row = rows().find((r) => r.id === "2");
	expect(row).toMatchObject({ unread: true });
	expect(row.cells.name.sub).toBe("Back from Progressing");
	expect(row.pane.find((n: any) => n.tone === "muted").text).toContain("25m worked in 1 session");
	expect(row.pane[0]).toMatchObject({ type: "text", text: "New · Back from Progressing", tone: "info" });
	expect(lastBadge()).toEqual({ type: "badge", value: 1 });
	await event("select", { table: "tasks", rowId: "2" });
	expect(rows().find((r) => r.id === "2").unread).toBeUndefined();
	expect(lastBadge()).toEqual({ type: "badge", value: null });
});

test("drag between sections performs the matching transition", async () => {
	const { saved, event } = await start(fixture());
	await event("reorder", { table: "tasks", rowId: "1", section: "working", before: null });
	await event("reorder", { table: "tasks", rowId: "2", section: "settled", before: null });
	expect(bySection()).toEqual({ inbox: ["Fix login bug"], working: ["Write spec"], watching: [], snoozed: [], settled: ["Reply to Anna"] });
	expect(Object.keys(saved.at(-1)!.order)).toEqual(["inbox", "working"]);
	await event("reorder", { table: "tasks", rowId: "2", section: "snoozed", before: null });
	expect(toasts().at(-1)).toMatchObject({ text: "Choose Snooze to pick a wake time.", tone: "error" });
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
	await event("undo", undefined, "toast");
	expect(bySection().settled).toEqual([]);
	expect(bySection().inbox).toContain("Write spec");
	await event("delete", { rowId: "2" });
	clock += 6_000;
	await event("undo", undefined, "toast");
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
	await event("undo", undefined, "toast");
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
	expect(form().fields.find((f: any) => f.id === "state").options[1].label).toStartWith("Progressing · since");
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

test("the quick view adds tasks and updates, and snoozes, without the window", async () => {
	const { event, saved } = await start(fixture());
	expect(tree("quick").children[0]).toMatchObject({ type: "composer", id: "quick-task", single: true, key: "n" });
	await event("quick-task", { composer: "quick-task", text: "Buy stamps" }, "quick");
	const added = saved.at(-1)!.tasks.at(-1)!;
	expect([added.name, added.state]).toEqual(["Buy stamps", "inbox"]);
	expect(toasts().at(-1)).toMatchObject({ text: `Added #${added.id} to the Inbox` });

	const item = quickList().items.find((i: any) => i.id === "1");
	expect(item.actions.map((a: any) => a.id)).toEqual(["start", "add-update", "snooze:tomorrow", "settle"]);
	expect(item.actions[1].input).toBeDefined();
	await event("add-update", { rowId: "1", text: "Asked for a quote" }, "quick");
	expect(quickList().items.find((i: any) => i.id === "1").subtitle).toContain("Asked for a quote");
	await event("snooze:tomorrow", { rowId: "1" }, "quick");
	expect(saved.at(-1)!.tasks.find((t) => t.id === 1)!.state).toBe("snoozed");
});

test("watch a task, see it come back for its check-in with why, and keep waiting from the window or quick view", async () => {
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
	expect(row.cells.when).toMatchObject({ at: nov(20), icon: "eye" });
	expect(row.actions).toEqual(expect.arrayContaining(["edit-watch", "stop-watching"]));
	expect(row.actions).not.toContain("still-waiting");
	expect(row.actions).not.toContain("snooze");

	// Still waiting before the check-in came: the dialog says so and proposes the one after.
	await event("still-waiting", { rowId: "1" });
	dialog = tree("screen:tasks").dialog;
	expect(dialog.id).toBe("stillWaiting");
	expect(dialog.description).toMatch(/^The next check-in, Nov 20.*9:00 AM, hasn't come yet\. Keeping waiting moves it out to Dec 4.*: confirm the date, or keep Nov 20/);
	fields = dialog.children[0].fields;
	expect(fields.map((f: any) => [f.id, f.value])).toEqual([["next", "2026-12-04T09:00"], ["note", ""]]);
	expect(fields[0].presets.slice(0, 2).map((p: any) => p.value)).toEqual(["2026-11-20T09:00", "2026-12-04T09:00"]);
	// Keep the upcoming one: only the check is logged.
	await event("field", { form: "stillWaiting", field: "next", value: "2026-11-20T09:00" });
	await event("field", { form: "stillWaiting", field: "note", value: "Portal says pending." });
	await event("save", { dialog: "stillWaiting" });
	expect(saved.at(-1)!.tasks[0]).toMatchObject({ state: "watching", watch: { next: nov(20), anchor: nov(20), checks: 1 } });
	expect(saved.at(-1)!.tasks[0]!.updates.at(-1)!.text).toBe("Checked in: still waiting on Cobra team.\n\nPortal says pending.");
	await event("undo");
	// Closing the dialog changes nothing.
	await event("still-waiting", { rowId: "1" });
	await event("dialog-close", { dialog: "stillWaiting" });
	expect(saved.at(-1)!.tasks[0]!.watch!.checks).toBe(0);
	expect(tree("screen:tasks").summary).toBe("2 open · 1 watching");
	expect(paneNode("1", "task").fields[1].options.find((o: any) => o.value === "watching").label).toMatch(/^Watching · next check-in Nov 20/);

	// The check-in comes due: back on top of the Inbox, unread, saying why.
	clock = nov(20);
	await event("search", { query: "" });
	row = rows().find((r) => r.id === "1");
	expect(row).toMatchObject({ group: "inbox", unread: true });
	expect(row.cells.name.sub).toBe("Time to check in · waiting on Cobra team for 5 days · not checked yet · every 2 weeks");
	expect(row.cells.name.marks).toEqual([{ icon: "eye", tooltip: "Watching: waiting on Cobra team" }]);
	expect(lastBadge()).toMatchObject({ value: 1 });
	const item = quickList().items.find((i: any) => i.id === "1");
	expect(item.actions.map((a: any) => a.id)).toEqual(["start", "still-waiting", "add-update", "snooze:tomorrow", "settle"]);

	// Still waiting from the quick view opens the main window on the task, with the dialog
	// proposing the next date on schedule (Dec 4, two weeks on).
	await event("still-waiting", { rowId: "1" }, "quick");
	expect(host!.messages.filter((m: any) => m.type === "navigate").at(-1)).toMatchObject({ screen: "tasks", select: "1" });
	expect(tree("screen:tasks").dialog.description).toBe("It comes back on its schedule (every 2 weeks): confirm the date or pick another.");
	await event("save", { dialog: "stillWaiting" });
	expect(saved.at(-1)!.tasks[0]).toMatchObject({ state: "watching", unread: false, watch: { next: nov(34), checks: 1 } });
	expect(saved.at(-1)!.tasks[0]!.updates.at(-1)!.text).toBe("Checked in: still waiting on Cobra team.");
	expect(toasts().at(-1)).toMatchObject({ text: expect.stringMatching(/^Still waiting on #1 · next check-in /), action: { id: "undo" } });
	await event("undo");
	expect(rows().find((r) => r.id === "1").group).toBe("inbox");

	// Stop watching from the drawer's status: an ordinary task again.
	await event("still-waiting", { rowId: "1" });
	await event("save", { dialog: "stillWaiting" });
	await event("field", { form: "task", field: "state", value: "inbox", rowId: "1" });
	expect(saved.at(-1)!.tasks[0]!.watch).toBeUndefined();
	expect(rows().find((r) => r.id === "1").group).toBe("inbox");
	// The drawer's status opens the Watch dialog; a drag watches weekly.
	await event("field", { form: "task", field: "state", value: "watching", rowId: "1" });
	expect(tree("screen:tasks").dialog.id).toBe("watch");
	await event("save", { dialog: "watch" });
	// The host reports a drop into the Watching group as Progressing; the end of it is Watching.
	await event("reorder", { table: "tasks", rowId: "2", section: "working", before: null });
	expect(saved.at(-1)!.tasks[1]).toMatchObject({ state: "watching", watch: { every: { n: 1, unit: "week" }, next: nov(27) } });
	expect(toasts().at(-1).text).toMatch(/^Watching #2 · next check-in /);
});

