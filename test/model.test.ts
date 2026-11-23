import { describe, expect, test } from "bun:test";
import * as m from "../src/model";
import { snippet } from "../src/ui";

const NOW = new Date(2026, 10, 14, 12, 0).getTime();
const task = (data: m.Data, name: string, extra: Partial<m.TaskInput> = {}) =>
	m.addTask(data, { name, due: "", desc: "", labels: {}, ...extra }, NOW);

describe("seed", () => {
	test("has the four default labels and relation types", () => {
		const d = m.seed();
		expect(d.labels.map((l) => [l.name, l.type])).toEqual([
			["Project", "string"],
			["isPersonal", "bool"],
			["Priority", "string"],
			["Status", "string"],
		]);
		expect(d.relationTypes.map((t) => t.id)).toEqual(["parent", "relatedTo", "supersedes", "blocks"]);
		expect(d.nextLabelId).toBe(5);
	});
});

describe("due dates", () => {
	test("accepts a date with an optional time and normalizes it", () => {
		expect(m.parseDue(" 2026-11-20 ")).toBe("2026-11-20");
		expect(m.parseDue("2026-11-20 9:05")).toBe("2026-11-20T09:05");
		expect(m.parseDue("2026-11-20T14:30")).toBe("2026-11-20T14:30");
		expect(m.parseDue("")).toBeUndefined();
	});
	test("rejects impossible dates and times", () => {
		for (const bad of ["2026-02-30", "2026-11-20 24:00", "2026-11-20 10:60", "next week", "20/11/2026"])
			expect(() => m.parseDue(bad)).toThrow(m.InvalidInput);
	});
	test("a date without time is due at the end of that day", () => {
		expect(m.dueAt("2026-11-14")).toBe(new Date(2026, 10, 15).getTime() - 1);
		expect(m.dueAt("2026-11-14T09:30")).toBe(new Date(2026, 10, 14, 9, 30).getTime());
	});
});

describe("tasks", () => {
	test("ids and timestamps are assigned automatically", () => {
		const d = m.seed();
		const a = task(d, " Write spec ");
		const b = task(d, "Review");
		expect([a.id, b.id, a.name, a.created, a.updated]).toEqual([1, 2, "Write spec", NOW, NOW]);
		m.updateTask(d, a.id, { name: "Write spec", due: "2026-11-20", desc: "# Hi", labels: {} }, NOW + 5);
		expect(a.updated).toBe(NOW + 5);
		expect(a.created).toBe(NOW);
		expect(a.due).toBe("2026-11-20");
		m.deleteTask(d, a.id, NOW);
		expect(task(d, "Next").id).toBe(3);
	});
	test("label values must fit the label", () => {
		const d = m.seed();
		const t = task(d, "x", { labels: { 1: "Toolbelt", 2: true, 3: "High", 4: "" } });
		expect(t.labels).toEqual({ 1: "Toolbelt", 2: true, 3: "High" });
		expect(() => task(d, "y", { labels: { 3: "Urgent" } })).toThrow("Urgent is not a value of Priority.");
		expect(() => task(d, "y", { labels: { 2: "yes" } })).toThrow(m.InvalidInput);
		expect(() => task(d, "y", { labels: { 99: "x" } })).toThrow(m.InvalidInput);
		expect(() => task(d, "  ")).toThrow("A task needs a name.");
		expect(task(d, "z").id).toBe(2);
	});
});

describe("labels", () => {
	test("names are unique and bool labels have no values", () => {
		const d = m.seed();
		expect(() => m.addLabel(d, { name: "status", type: "string", color: "red", values: [], freeform: false })).toThrow(m.InvalidInput);
		const l = m.addLabel(d, { name: "Urgent", type: "bool", color: "red", values: [{ text: "a" }], freeform: true });
		expect(l).toEqual({ id: 5, name: "Urgent", type: "bool", color: "red", values: [], freeform: false });
		expect(() => m.addLabel(d, { name: "X", type: "string", color: "magenta", values: [], freeform: false })).toThrow(m.InvalidInput);
	});
	test("narrowing a lookup list drops values tasks can no longer have", () => {
		const d = m.seed();
		const t = task(d, "x", { labels: { 3: "Low", 4: "Todo" } });
		m.updateLabel(d, 3, { name: "Priority", type: "string", color: "orange", values: [{ text: "High", color: "red" }, { text: " Medium ", color: "amber" }, { text: "High" }], freeform: false }, NOW + 1);
		expect(d.labels[2]!.values).toEqual([{ text: "High", color: "red" }, { text: "Medium", color: "amber" }]);
		expect(t.labels).toEqual({ 4: "Todo" });
		expect(t.updated).toBe(NOW + 1);
	});
	test("renaming a value renames it on tasks; renaming onto another merges them", () => {
		const d = m.seed();
		const a = task(d, "a", { labels: { 3: "Low" } });
		const b = task(d, "b", { labels: { 3: "Medium" } });
		const c = task(d, "c", { labels: { 3: "High" } });
		m.updateLabel(d, 3, { name: "Priority", type: "string", color: "orange", values: [{ text: "Top", color: "red", from: "High" }, { text: "Top", color: "amber", from: "Medium" }, { text: "Later", color: "sky", from: "Low" }], freeform: false }, NOW + 1);
		expect(d.labels[2]!.values).toEqual([{ text: "Top", color: "red" }, { text: "Later", color: "sky" }]);
		expect([a, b, c].map((t) => t.labels[3])).toEqual(["Later", "Top", "Top"]);
		// Swapping two names swaps them on tasks too.
		m.updateLabel(d, 3, { name: "Priority", type: "string", color: "orange", values: [{ text: "Later", from: "Top" }, { text: "Top", from: "Later" }], freeform: false }, NOW + 2);
		expect([a, b, c].map((t) => t.labels[3])).toEqual(["Top", "Later", "Later"]);
	});
	test("new values get a color the label uses least, and typed values join a free-text label", () => {
		const d = m.seed();
		const l = m.addLabel(d, { name: "Area", type: "string", color: "blue", values: [{ text: "Home", color: "red" }, { text: "Work" }], freeform: true, valueColors: true }, () => 0);
		expect(l.values[1]!.color).not.toBe("red");
		expect(["slate", "stone", "orange", "rose"]).not.toContain(l.values[1]!.color);
		const t = m.addTask(d, { name: "x", due: "", desc: "", labels: { [l.id]: " Garden " } }, NOW, () => 0);
		expect(t.labels[l.id]).toBe("Garden");
		expect(l.values.map((v) => v.text)).toEqual(["Home", "Work", "Garden"]);
		expect(new Set(l.values.map((v) => v.color)).size).toBe(3);
		expect(m.colorOf(l, "Garden")).toBe(l.values[2]!.color);
		// Lookups still refuse unknown values, and add nothing.
		expect(() => task(d, "y", { labels: { 3: "Whenever" } })).toThrow(m.InvalidInput);
		expect(d.labels[2]!.values).toHaveLength(3);
		// One color: every value is drawn in the label's.
		expect(m.colorOf(d.labels[2]!, "High")).toBe("orange");
		expect(m.valueCounts(d, l)).toEqual(new Map([["Garden", 1]]));
	});
	test("deleting a label removes it from tasks", () => {
		const d = m.seed();
		const t = task(d, "x", { labels: { 4: "Todo" } });
		m.deleteLabel(d, 4, NOW + 1);
		expect(t.labels).toEqual({});
		expect(d.labels.some((l) => l.id === 4)).toBe(false);
	});
});

describe("relations", () => {
	test("are stored once and read from both sides", () => {
		const d = m.seed();
		const [a, b] = [task(d, "Epic"), task(d, "Step")];
		m.relate(d, b.id, "parent", a.id, false, NOW + 1);
		expect(b.relations).toEqual([{ task: a.id, type: "parent" }]);
		expect(m.relationsOf(d, b.id).map((r) => r.label)).toEqual(["Parent"]);
		expect(m.relationsOf(d, a.id).map((r) => [r.label, r.task])).toEqual([["Child", b.id]]);
		expect(a.updated).toBe(NOW + 1);
	});
	test("an inverse choice is stored on the other task", () => {
		const d = m.seed();
		const [a, b] = [task(d, "Epic"), task(d, "Step")];
		// "Epic is the Parent of Step" is stored on Step as Parent: Epic.
		m.relate(d, a.id, "parent", b.id, true, NOW);
		expect(b.relations).toEqual([{ task: a.id, type: "parent" }]);
		expect(a.relations).toEqual([]);
	});
	test("rejects self, duplicate and cyclic parent relations", () => {
		const d = m.seed();
		const [a, b, c] = [task(d, "a"), task(d, "b"), task(d, "c")];
		expect(() => m.relate(d, a.id, "blocks", a.id, false, NOW)).toThrow(m.InvalidInput);
		m.relate(d, b.id, "parent", a.id, false, NOW);
		m.relate(d, c.id, "parent", b.id, false, NOW);
		expect(() => m.relate(d, b.id, "parent", a.id, false, NOW)).toThrow("already related");
		expect(() => m.relate(d, a.id, "parent", c.id, false, NOW)).toThrow("own ancestor");
	});
	test("deleting a task removes relations pointing at it; unrelate removes one", () => {
		const d = m.seed();
		const [a, b, c] = [task(d, "a"), task(d, "b"), task(d, "c")];
		m.relate(d, b.id, "blocks", a.id, false, NOW);
		m.relate(d, c.id, "relatedTo", a.id, false, NOW);
		m.unrelate(d, c.id, "relatedTo", a.id, NOW);
		expect(c.relations).toEqual([]);
		m.deleteTask(d, a.id, NOW + 2);
		expect(b.relations).toEqual([]);
		expect(b.updated).toBe(NOW + 2);
	});
	test("relation types get stable ids and can't be deleted while used", () => {
		const d = m.seed();
		m.saveRelationType(d, { name: "Duplicates", inverse: "" });
		m.saveRelationType(d, { name: "duplicates", inverse: "Duplicated by" });
		expect(d.relationTypes.slice(-2)).toEqual([
			{ id: "duplicates", name: "Duplicates", inverse: "Duplicates" },
			{ id: "duplicates2", name: "duplicates", inverse: "Duplicated by" },
		]);
		const [a, b] = [task(d, "a"), task(d, "b")];
		m.relate(d, a.id, "duplicates", b.id, false, NOW);
		expect(() => m.deleteRelationType(d, "duplicates")).toThrow("1 task uses");
		m.deleteRelationType(d, "duplicates2");
	});
});

test("new tasks start in the Inbox, on top", () => {
	const d = m.seed();
	const [a, b] = [task(d, "a"), task(d, "b")];
	expect([a.state, a.archived, a.unread, a.sessions]).toEqual(["inbox", false, false, []]);
	expect("pinned" in a).toBe(false);
	expect(d.order.inbox).toEqual([b.id, a.id]);
	m.deleteTask(d, a.id, NOW);
	expect(d.order.inbox).toEqual([b.id]);
});

test("schema 1 data gets a lifecycle; Status Done becomes settled", () => {
	const old = { ...m.seed(), schema: 1, order: undefined, labels: [...m.seed().labels.slice(0, 3), { id: 4, name: "Status", type: "string", color: "emerald", values: ["Todo", "Done"], freeform: false }] } as any;
	old.tasks = [
		{ id: 1, name: "open", created: 1, updated: 2, desc: "", labels: { 4: "Todo" }, relations: [] },
		{ id: 2, name: "done", created: 1, updated: 5, desc: "", labels: { 4: "Done" }, relations: [] },
	];
	const d = m.upgrade1to2(old);
	expect(d.schema).toBe(2);
	expect(d.tasks.map((t: m.Task) => [t.state, t.settledAt])).toEqual([["inbox", undefined], ["settled", 5]]);
	expect(d.order).toEqual({ pinned: [], inbox: [1], working: [] });
	expect(() => m.upgrade1to2(d)).toThrow(m.InvalidInput);
	const three = m.upgrade2to3(d);
	expect(three).toMatchObject({ schema: 3, nextUpdateId: 1 });
	expect(three.tasks.map((t: m.Task) => t.updates)).toEqual([[], []]);
	expect(() => m.upgrade2to3(three)).toThrow(m.InvalidInput);
	const four = m.upgrade3to4(three);
	expect(four.schema).toBe(4);
	expect(() => m.upgrade3to4(four)).toThrow(m.InvalidInput);
	const five = m.upgrade4to5(four);
	expect(m.parseData(JSON.parse(JSON.stringify(five)))).toEqual(JSON.parse(JSON.stringify(five)));
	expect(() => m.upgrade4to5(five)).toThrow(m.InvalidInput);
	expect(four.order).toEqual({ inbox: [1], working: [] });
	expect(four.tasks.some((t: any) => "pinned" in t)).toBe(false);
	expect(four.labels).toEqual(three.labels); // nothing was pinned, so no label
	// Pins become a yes/no label, reusing one named Pinned when it's yes/no.
	const pinnedThree = { ...three, order: { ...three.order, pinned: [2] }, tasks: three.tasks.map((t: any) => ({ ...t, pinned: t.id === 2 })) };
	const withPins = m.upgrade3to4(pinnedThree);
	const label = withPins.labels.at(-1)!;
	expect(label).toMatchObject({ id: three.nextLabelId, name: "Pinned", type: "bool" });
	expect(withPins.nextLabelId).toBe(three.nextLabelId + 1);
	expect(withPins.tasks.map((t: any) => t.labels[label.id] === true)).toEqual([false, true]);
	const taken = { ...pinnedThree, labels: [...three.labels, { id: 99, name: "pinned", type: "string", color: "red", values: [], freeform: true }] };
	expect(m.upgrade3to4(taken).labels.at(-1)!.name).toBe("Pinned 2");
	const reuse = { ...pinnedThree, labels: [...three.labels, { id: 99, name: "Pinned", type: "bool", color: "red", values: [], freeform: false }] };
	expect(m.upgrade3to4(reuse).tasks[1]!.labels[99]).toBe(true);
	// A damaged watch fails loudly.
	const bad = JSON.parse(JSON.stringify(four));
	bad.tasks[0].watch = { since: "yesterday" };
	expect(() => m.parseData(bad)).toThrow(m.InvalidInput);
});

describe("updates", () => {
	test("are added as of now, newest first, and bump the task", () => {
		const d = m.seed();
		const a = task(d, "a");
		const first = m.addUpdate(d, a.id, "Started  \n", NOW + 1);
		const second = m.addUpdate(d, a.id, "**Halfway**", NOW + 2);
		expect(first).toEqual({ id: 1, added: NOW + 1, updated: NOW + 1, text: "Started" });
		expect(d.nextUpdateId).toBe(3);
		expect(a.updated).toBe(NOW + 2);
		expect(m.updatesOf(a).map((u) => u.id)).toEqual([second.id, first.id]);
		expect(() => m.addUpdate(d, a.id, "   ", NOW)).toThrow(m.InvalidInput);
		expect(() => m.addUpdate(d, 99, "x", NOW)).toThrow(m.InvalidInput);
	});
	test("editing the text moves last updated; times can be corrected within reason", () => {
		const d = m.seed();
		const a = task(d, "a");
		const u = m.addUpdate(d, a.id, "one", NOW);
		m.editUpdate(d, a.id, u.id, { text: "one" }, NOW + 10_000);
		expect(u.updated).toBe(NOW);
		m.editUpdate(d, a.id, u.id, { text: "two" }, NOW + 20_000);
		expect(u).toMatchObject({ text: "two", added: NOW, updated: NOW + 20_000 });
		m.editUpdate(d, a.id, u.id, { text: "two", added: NOW - 86_400_000, updated: NOW - 3_600_000 }, NOW + 30_000);
		expect(u).toMatchObject({ added: NOW - 86_400_000, updated: NOW - 3_600_000 });
		// Backdating the start past last updated is fine; moving it after last updated drags that along.
		m.editUpdate(d, a.id, u.id, { text: "two", added: NOW - 60_000 }, NOW + 40_000);
		expect(u.updated).toBe(NOW - 60_000);
		expect(() => m.editUpdate(d, a.id, u.id, { text: "two", added: NOW + 86_400_000 }, NOW)).toThrow("future");
		expect(() => m.editUpdate(d, a.id, u.id, { text: "two", added: NOW, updated: NOW - 1 }, NOW)).toThrow("before");
		expect(() => m.editUpdate(d, a.id, u.id, { text: "" }, NOW)).toThrow(m.InvalidInput);
		expect(() => m.editUpdate(d, a.id, 99, { text: "x" }, NOW)).toThrow(m.InvalidInput);
	});
	test("delete removes one update", () => {
		const d = m.seed();
		const a = task(d, "a");
		const [x, y] = [m.addUpdate(d, a.id, "x", NOW), m.addUpdate(d, a.id, "y", NOW)];
		m.deleteUpdate(d, a.id, x.id, NOW + 5);
		expect(a.updates).toEqual([y]);
		expect(a.updated).toBe(NOW + 5);
		expect(() => m.deleteUpdate(d, a.id, x.id, NOW)).toThrow(m.InvalidInput);
	});
	test("datetime field values convert to and from epoch ms", () => {
		const at = new Date(2026, 10, 14, 9, 30, 42).getTime();
		expect(m.toLocalInput(at)).toBe("2026-11-14T09:30");
		expect(m.fromLocalInput("2026-11-14T09:30", at, "Added")).toBe(at);
		expect(m.fromLocalInput("2026-11-13T08:05", at, "Added")).toBe(new Date(2026, 10, 13, 8, 5).getTime());
		expect(m.fromLocalInput("2026-11-12", at, "Added")).toBe(new Date(2026, 10, 12, 9, 30).getTime());
		expect(() => m.fromLocalInput("", at, "Added")).toThrow("Added needs");
	});
});

test("parseData rejects other schemas and damaged files", () => {
	expect(m.parseData(JSON.parse(JSON.stringify(m.seed())))).toEqual(m.seed());
	expect(() => m.parseData({ schema: 2 })).toThrow(m.InvalidInput);
	expect(() => m.parseData({ ...m.seed(), nextUpdateId: undefined })).toThrow(m.InvalidInput);
	expect(() => m.parseData({ ...m.seed(), tasks: [{ id: 1 }] })).toThrow(m.InvalidInput);
	expect(() => m.parseData({ ...m.seed(), tasks: null })).toThrow(m.InvalidInput);
	expect(() => m.parseData({ ...m.seed(), order: undefined })).toThrow(m.InvalidInput);
});

test("the table shows the description's first line without Markdown", () => {
	expect(snippet("\n# First **release** of [OnTrack](https://x)\nmore")).toBe("First release of OnTrack");
	expect(snippet("- `code` item")).toBe("code item");
	expect(snippet("  ")).toBeUndefined();
});

test("schema 4 → 5: values get colors; typed values join free-text labels after the listed ones", () => {
	const four = {
		...m.seed(),
		schema: 4,
		labels: [
			{ id: 1, name: "Project", type: "string", color: "blue", values: ["Toolbelt"], freeform: true },
			{ id: 2, name: "isPersonal", type: "bool", color: "violet", values: [], freeform: false },
			{ id: 3, name: "Priority", type: "string", color: "orange", values: ["High", "Medium", "Low"], freeform: false, shades: "strongest-first" },
		],
		tasks: [
			{ id: 1, labels: { 1: "Garden", 3: "High" } },
			{ id: 2, labels: { 1: "Toolbelt", 2: true } },
			{ id: 3, labels: { 1: "Attic" } },
		],
	};
	const five = m.upgrade4to5(four, () => 0);
	expect(five.schema).toBe(m.SCHEMA);
	const [project, flag, priority] = five.labels;
	expect(project!.values.map((v) => v.text)).toEqual(["Toolbelt", "Attic", "Garden"]);
	expect(new Set(project!.values.map((v) => v.color)).size).toBe(3);
	expect(flag!.values).toEqual([]);
	expect(priority!.values.map((v) => v.text)).toEqual(["High", "Medium", "Low"]);
	// Still one color, still shaded.
	expect(priority).toMatchObject({ shades: "strongest-first" });
	expect(priority!.valueColors).toBeUndefined();
	// Values already in the new shape keep their colors (a retried migration).
	const again = m.upgrade4to5({ ...four, labels: five.labels });
	expect(again.labels).toEqual(five.labels);
});

describe("label shades", () => {
	test("listed values get intensities in list order; others and unshaded labels get none", () => {
		const d = m.seed();
		const priority = d.labels.find((l) => l.name === "Priority")!;
		expect(["High", "Medium", "Low", "Other"].map((v) => m.shadeOf(priority, v))).toEqual([1, 0.5, 0, undefined]);
		const status = d.labels.find((l) => l.name === "Status")!;
		expect(m.shadeOf(status, "Todo")).toBeUndefined();
		m.updateLabel(d, status.id, { name: "Status", type: "string", color: "emerald", values: status.values, freeform: false, shades: "lightest-first" }, NOW);
		expect(status.values.map((v) => m.shadeOf(status, v.text))).toEqual([0, 0.5, 1]);
		// A color per value takes the place of shades.
		m.updateLabel(d, status.id, { name: "Status", type: "string", color: "emerald", values: status.values, freeform: false, valueColors: true, shades: "lightest-first" }, NOW);
		expect(status.shades).toBeUndefined();
		expect(m.shadeOf(status, "Todo")).toBeUndefined();
	});
	test("shades need two listed values and a known order", () => {
		const d = m.seed();
		const one = m.addLabel(d, { name: "Solo", type: "string", color: "blue", values: [{ text: "Only" }], freeform: false, shades: "strongest-first" });
		expect(one.shades).toBeUndefined();
		expect(() => m.addLabel(d, { name: "Bad", type: "string", color: "blue", values: [{ text: "a" }, { text: "b" }], freeform: false, shades: "sideways" })).toThrow(m.InvalidInput);
		const flag = m.addLabel(d, { name: "Flag", type: "bool", color: "blue", values: [], freeform: false, shades: "strongest-first" });
		expect(flag.shades).toBeUndefined();
	});
});
