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
		const l = m.addLabel(d, { name: "Urgent", type: "bool", color: "red", values: ["a"], freeform: true });
		expect(l).toEqual({ id: 5, name: "Urgent", type: "bool", color: "red", values: [], freeform: false });
		expect(() => m.addLabel(d, { name: "X", type: "string", color: "magenta", values: [], freeform: false })).toThrow(m.InvalidInput);
	});
	test("narrowing a lookup list drops values tasks can no longer have", () => {
		const d = m.seed();
		const t = task(d, "x", { labels: { 3: "Low", 4: "Todo" } });
		m.updateLabel(d, 3, { name: "Priority", type: "string", color: "orange", values: ["High", " Medium ", "High"], freeform: false }, NOW + 1);
		expect(d.labels[2]!.values).toEqual(["High", "Medium"]);
		expect(t.labels).toEqual({ 4: "Todo" });
		expect(t.updated).toBe(NOW + 1);
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
	expect([a.state, a.pinned, a.archived, a.unread, a.sessions]).toEqual(["inbox", false, false, false, []]);
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
	expect(d.tasks.map((t) => [t.state, t.settledAt])).toEqual([["inbox", undefined], ["settled", 5]]);
	expect(d.order).toEqual({ pinned: [], inbox: [1], working: [] });
	expect(m.parseData(JSON.parse(JSON.stringify(d)))).toEqual(JSON.parse(JSON.stringify(d)));
	expect(() => m.upgrade1to2(d)).toThrow(m.InvalidInput);
});

test("parseData rejects other schemas and damaged files", () => {
	expect(m.parseData(JSON.parse(JSON.stringify(m.seed())))).toEqual(m.seed());
	expect(() => m.parseData({ schema: 2 })).toThrow(m.InvalidInput);
	expect(() => m.parseData({ ...m.seed(), tasks: null })).toThrow(m.InvalidInput);
	expect(() => m.parseData({ ...m.seed(), order: undefined })).toThrow(m.InvalidInput);
});

test("the table shows the description's first line without Markdown", () => {
	expect(snippet("\n# First **release** of [OnTrack](https://x)\nmore")).toBe("First release of OnTrack");
	expect(snippet("- `code` item")).toBe("code item");
	expect(snippet("  ")).toBeUndefined();
});

describe("label shades", () => {
	test("listed values get intensities in list order; others and unshaded labels get none", () => {
		const d = m.seed();
		const priority = d.labels.find((l) => l.name === "Priority")!;
		expect(["High", "Medium", "Low", "Other"].map((v) => m.shadeOf(priority, v))).toEqual([1, 0.5, 0, undefined]);
		const status = d.labels.find((l) => l.name === "Status")!;
		expect(m.shadeOf(status, "Todo")).toBeUndefined();
		m.updateLabel(d, status.id, { name: "Status", type: "string", color: "emerald", values: status.values, freeform: false, shades: "lightest-first" }, NOW);
		expect(status.values.map((v) => m.shadeOf(status, v))).toEqual([0, 0.5, 1]);
	});
	test("shades need two listed values and a known order", () => {
		const d = m.seed();
		const one = m.addLabel(d, { name: "Solo", type: "string", color: "blue", values: ["Only"], freeform: false, shades: "strongest-first" });
		expect(one.shades).toBeUndefined();
		expect(() => m.addLabel(d, { name: "Bad", type: "string", color: "blue", values: ["a", "b"], freeform: false, shades: "sideways" })).toThrow(m.InvalidInput);
		const flag = m.addLabel(d, { name: "Flag", type: "bool", color: "blue", values: [], freeform: false, shades: "strongest-first" });
		expect(flag.shades).toBeUndefined();
	});
});
