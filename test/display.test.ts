import { expect, test } from "bun:test";
import * as d from "../src/display";
import { addTask, seed, type Data } from "../src/model";
import { archive, transition } from "../src/lifecycle";
import { LOOKS, tableOrder } from "../src/ui";

const NOW = new Date(2026, 10, 14, 12, 0).getTime();
const day = (n: number) => {
	const x = new Date(NOW);
	x.setDate(x.getDate() + n);
	return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};

/** Website: #1 Inbox, #2 working; Taxes: #3 Inbox; no project: #4 settled. */
function fixture(): Data {
	const data = seed();
	addTask(data, { name: "Pricing page", due: "", desc: "", labels: { 1: "Website" } }, NOW);
	addTask(data, { name: "Footer links", due: "", desc: "", labels: { 1: "Website" } }, NOW);
	addTask(data, { name: "VAT", due: "", desc: "", labels: { 1: "Taxes" } }, NOW);
	addTask(data, { name: "Fonts", due: "", desc: "", labels: {} }, NOW);
	transition(data, 2, "working", {}, NOW);
	transition(data, 4, "settled", {}, NOW);
	return data;
}

test("a fresh row groups by Status showing Ongoing; Due and each label follow", () => {
	expect(seed().filters).toEqual([
		{ id: "status", group: true, selected: ["inbox", "working", "snoozed", "watching", "settled"] },
		{ id: "due", group: false, selected: [] },
		{ id: "label:1", group: false, selected: [] },
		{ id: "label:2", group: false, selected: [] },
		{ id: "label:3", group: false, selected: [] },
		{ id: "label:4", group: false, selected: [] },
	]);
});

test("the row follows the labels: gone ones leave, new ones come first among the rest, lost values drop", () => {
	const data = fixture();
	data.filters = [{ id: "label:3", group: true, selected: ["High", "Gone"] }, { id: "status", group: true, selected: [] }, { id: "label:9", group: false, selected: [] }, { id: "label:1", group: false, selected: [] }];
	data.labels.push({ id: 5, name: "Area", type: "string", color: "blue", values: [], freeform: true });
	expect(d.normalizeFilters(data).map((f) => [f.id, f.group, f.selected])).toEqual([
		["label:3", true, ["High"]],
		["status", true, []],
		["due", false, []],
		["label:2", false, []],
		["label:4", false, []],
		["label:5", false, []],
		["label:1", false, []],
	]);
});

test("arranging keeps every filter, puts grouping ones first and refuses more than ten levels", () => {
	const data = fixture();
	d.arrange(data, ["label:1", "status", "due"], ["label:1", "status"]);
	expect(data.filters.map((f) => [f.id, f.group])).toEqual([["label:1", true], ["status", true], ["due", false], ["label:2", false], ["label:3", false], ["label:4", false]]);
	// Status (2) + Due + four labels = 7 levels: fine. Ten more labels would pass the limit.
	for (let i = 0; i < 6; i++) data.labels.push({ id: 10 + i, name: `L${i}`, type: "bool", color: "blue", values: [], freeform: false });
	data.filters = d.normalizeFilters(data);
	expect(() => d.arrange(data, data.filters.map((f) => f.id), data.filters.map((f) => f.id))).toThrow("10 levels");
});

test("due buckets: overdue only while open, today, the next six days, later, past and none", () => {
	const data = fixture();
	const t = data.tasks[0]!;
	const bucket = (due: string | undefined) => d.dueBucket({ ...t, due }, NOW);
	expect([bucket(undefined), bucket(`${day(0)}T09:00`), bucket(day(0)), bucket(day(1)), bucket(day(6)), bucket(day(7)), bucket(day(-1))]).toEqual(["none", "overdue", "today", "next6", "next6", "later", "overdue"]);
	expect(d.dueBucket({ ...t, due: day(-1), state: "settled" }, NOW)).toBe("past");
	expect(d.dueBucket({ ...t, due: day(-1), archived: true }, NOW)).toBe("past");
});

test("Project › Status nests the groups, shows only groups with tasks, and names each by its path", () => {
	const data = fixture();
	d.arrange(data, ["label:1", "status"], ["label:1", "status"]);
	const { sections, groupOf } = d.groupTasks(data, tableOrder(data), NOW, LOOKS);
	const shape = (list: any[]): any[] => list.map((s) => (s.sections ? [s.id, s.label, shape(s.sections)] : [s.id, s.label, s.order ?? "manual"]));
	expect(shape(sections)).toEqual([
		["l1=Website", "Website", [["l1=Website/inbox", "Inbox", "manual"], ["l1=Website/progressing", "Progressing", [["l1=Website/working", "Working on", "manual"]]]]],
		["l1=Taxes", "Taxes", [["l1=Taxes/inbox", "Inbox", "manual"]]],
		["l1=__none", "No Project", [["l1=__none/settled", "Settled", "fixed"]]],
	]);
	expect(Object.fromEntries(groupOf)).toEqual({ 1: "l1=Website/inbox", 2: "l1=Website/working", 3: "l1=Taxes/inbox", 4: "l1=__none/settled" });
});

test("Status at the top shows each selected state even when empty, Archived last, collapsed and dimmed", () => {
	const data = fixture();
	archive(data, 3, NOW);
	data.filters[0]!.selected = [];
	const { sections } = d.groupTasks(data, tableOrder(data), NOW, LOOKS);
	expect(sections.map((s) => s.id)).toEqual(["inbox", "progressing", "settled", "archived"]);
	expect(sections[1]!.sections!.map((s) => s.id)).toEqual(["working", "snoozed", "watching"]);
	expect(sections.at(-1)).toMatchObject({ label: "Archived", collapsed: true, muted: true });
	// Only Inbox and Watching: Progressing holds just Watching.
	data.filters[0]!.selected = ["inbox", "watching"];
	const narrowed = d.groupTasks(data, tableOrder(data), NOW, LOOKS).sections;
	expect(narrowed.map((s) => [s.id, s.sections?.map((x) => x.id)])).toEqual([["inbox", undefined], ["progressing", ["watching"]]]);
});

test("filters narrow by every selection; a label's No value matches tasks without it", () => {
	const data = fixture();
	const shown = () => tableOrder(data).filter((t) => d.passes(data, t, NOW)).map((t) => t.id);
	expect(shown()).toEqual([3, 1, 2, 4]);
	d.setSelection(data, "label:1", ["__none", "Taxes", "bogus"]);
	expect(data.filters.find((f) => f.id === "label:1")!.selected).toEqual(["__none", "Taxes"]);
	expect(shown()).toEqual([3, 4]);
	archive(data, 4, NOW);
	expect(shown()).toEqual([3]);
});

test("a drop names every value along its section's path", () => {
	expect([...d.dropTarget("l1=Web%2Fsite/progressing")]).toEqual([["label:1", "Web/site"], ["status", "working"]]);
	expect([...d.dropTarget("d=today/l3=High/snoozed")]).toEqual([["due", "today"], ["label:3", "High"], ["status", "snoozed"]]);
	expect([...d.dropTarget("archived")]).toEqual([["status", "archived"]]);
	expect(d.dropTarget("").size).toBe(0);
});

test("a group's forest nests tasks under parents, with parents elsewhere as context up to the top", () => {
	const data = fixture();
	// #1 > #2 > #3 (#2 is working, so the Inbox has #1 and #3).
	data.tasks.find((t) => t.id === 2)!.relations.push({ task: 1, type: "parent" });
	data.tasks.find((t) => t.id === 3)!.relations.push({ task: 2, type: "parent" });
	const inbox = data.tasks.filter((t) => t.id === 3 || t.id === 1);
	const show = (nodes: d.TreeNode[]): any[] => nodes.map((n) => [n.task.id, n.context, show(n.children)]);
	expect(show(d.forest(data, inbox))).toEqual([[1, false, [[2, true, [[3, false, []]]]]]]);
	expect(d.rootOf(data, data.tasks.find((t) => t.id === 3)!).id).toBe(1);
	expect([...d.placement(data, data.tasks, "parent")].map(([id, root]) => [id, root.id])).toEqual([[2, 1], [3, 1]]);
	expect(d.placement(data, data.tasks, "own").size).toBe(0);
});
