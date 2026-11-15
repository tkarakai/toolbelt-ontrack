import { describe, expect, test } from "bun:test";
import * as life from "../src/lifecycle";
import * as m from "../src/model";

const NOW = new Date(2026, 10, 14, 12, 0).getTime();
const H = 3_600_000;

function setup(names = ["a", "b", "c"]) {
	const d = m.seed();
	const tasks = names.map((n) => m.addTask(d, { name: n, due: "", desc: "", labels: {} }, NOW));
	return { d, ids: tasks.map((t) => t.id) };
}
const names = (d: m.Data, section: life.SectionId) => life.inSection(d, section).map((t) => t.name);

describe("sections", () => {
	test("new tasks land on top of the Inbox", () => {
		const { d } = setup();
		expect(names(d, "inbox")).toEqual(["c", "b", "a"]);
	});

	test("working: start, done for now returns to the top of the Inbox unread, and sessions add up", () => {
		const { d, ids } = setup();
		const [a] = ids as [number];
		life.startWorking(d, a, NOW);
		expect(names(d, "working")).toEqual(["a"]);
		expect(life.workingSince(m.findTask(d, a))).toBe(NOW);
		life.doneForNow(d, a, NOW + 2 * H);
		const t = m.findTask(d, a);
		expect([t.state, t.unread, t.unreadReason]).toEqual(["inbox", true, "Back from Working"]);
		expect(names(d, "inbox")[0]).toBe("a");
		life.startWorking(d, a, NOW + 3 * H);
		expect(t.unread).toBe(false);
		expect(life.timeSpent(t, NOW + 4 * H)).toBe(3 * H);
		expect(() => life.startWorking(d, a, NOW)).toThrow(m.InvalidInput);
	});

	test("pinned tasks stay pinned while worked on, and keep their Inbox place when unpinned", () => {
		const { d, ids } = setup();
		const [a, b] = ids as [number, number];
		life.pin(d, b, NOW);
		expect(names(d, "pinned")).toEqual(["b"]);
		expect(names(d, "inbox")).toEqual(["c", "a"]);
		life.startWorking(d, b, NOW);
		expect(life.sectionOf(m.findTask(d, b))).toBe("pinned");
		life.doneForNow(d, b, NOW);
		life.unpin(d, b, NOW);
		expect(names(d, "inbox")[0]).toBe("b");
		life.pin(d, a, NOW);
		life.settle(d, a, NOW);
		expect(m.findTask(d, a).pinned).toBe(false);
		expect(d.order.pinned).toEqual([]);
	});

	test("snooze hides a task until it wakes, then it's on top and unread", () => {
		const { d, ids } = setup();
		const [a] = ids as [number];
		life.snooze(d, a, NOW + H, NOW);
		expect(names(d, "snoozed")).toEqual(["a"]);
		expect(life.nextWake(d, NOW)).toBe(NOW + H);
		expect(life.tick(d, NOW + H - 1)).toBe(false);
		expect(life.tick(d, NOW + H)).toBe(true);
		const t = m.findTask(d, a);
		expect([t.state, t.unread, t.unreadReason, t.snoozedUntil]).toEqual(["inbox", true, "Snooze ended", undefined]);
		expect(names(d, "inbox")[0]).toBe("a");
		expect(() => life.snooze(d, a, NOW - 1, NOW)).toThrow(m.InvalidInput);
	});

	test("waking by hand doesn't mark unread", () => {
		const { d, ids } = setup();
		life.snooze(d, ids[0]!, NOW + H, NOW);
		life.wake(d, ids[0]!, NOW);
		expect(m.findTask(d, ids[0]!).unread).toBe(false);
	});

	test("a due date arriving wakes a snoozed task early and marks open tasks unread once", () => {
		const { d, ids } = setup();
		const [a, b] = ids as [number, number];
		m.updateTask(d, a, { name: "a", due: "2026-11-14 13:00", desc: "", labels: {} }, NOW);
		m.updateTask(d, b, { name: "b", due: "2026-11-14 13:30", desc: "", labels: {} }, NOW);
		life.snooze(d, a, NOW + 10 * H, NOW);
		expect(life.nextWake(d, NOW)).toBe(NOW + H);
		life.tick(d, NOW + H);
		expect(m.findTask(d, a)).toMatchObject({ state: "inbox", unread: true, unreadReason: "Due now" });
		life.tick(d, NOW + 2 * H);
		expect(m.findTask(d, b)).toMatchObject({ unread: true, unreadReason: "Due now" });
		life.markRead(m.findTask(d, b));
		expect(life.tick(d, NOW + 3 * H)).toBe(false);
		// A new due date is announced again.
		m.updateTask(d, b, { name: "b", due: "2026-11-14 16:00", desc: "", labels: {} }, NOW);
		life.tick(d, NOW + 4 * H);
		expect(m.findTask(d, b).unread).toBe(true);
	});

	test("settled tasks are never marked unread, and nothing settles on its own", () => {
		const { d, ids } = setup();
		m.updateTask(d, ids[0]!, { name: "a", due: "2026-11-14", desc: "", labels: {} }, NOW);
		life.settle(d, ids[0]!, NOW);
		life.tick(d, NOW + 48 * H);
		expect(m.findTask(d, ids[0]!)).toMatchObject({ state: "settled", unread: false });
		expect(names(d, "inbox")).toEqual(["c", "b"]);
	});

	test("settling marks unblocked tasks and finished parents unread", () => {
		const { d, ids } = setup(["blocker", "blocked", "parent", "child1", "child2"]);
		const [blocker, blocked, parent, c1, c2] = ids as [number, number, number, number, number];
		m.relate(d, blocker, "blocks", blocked, false, NOW);
		m.relate(d, c1, "parent", parent, false, NOW);
		m.relate(d, c2, "parent", parent, false, NOW);
		life.settle(d, blocker, NOW);
		expect(m.findTask(d, blocked)).toMatchObject({ unread: true, unreadReason: `Unblocked: #${blocker} is settled` });
		life.settle(d, c1, NOW);
		expect(m.findTask(d, parent).unread).toBe(false);
		life.settle(d, c2, NOW);
		expect(m.findTask(d, parent)).toMatchObject({ unread: true, unreadReason: "All subtasks are settled" });
	});

	test("settled shows newest first and un-settle returns to the top of the Inbox", () => {
		const { d, ids } = setup();
		const [a, b] = ids as [number, number];
		life.settle(d, a, NOW);
		life.settle(d, b, NOW + 1);
		expect(names(d, "settled")).toEqual(["b", "a"]);
		life.unsettle(d, a, NOW);
		expect(names(d, "inbox")[0]).toBe("a");
	});

	test("archive hides a task from every section", () => {
		const { d, ids } = setup();
		life.startWorking(d, ids[0]!, NOW);
		life.archive(d, ids[0]!, NOW + H);
		const t = m.findTask(d, ids[0]!);
		expect([t.archived, t.state, t.sessions[0]!.end]).toEqual([true, "inbox", NOW + H]);
		expect(names(d, "working")).toEqual([]);
		expect(names(d, "inbox")).toEqual(["c", "b"]);
		life.unarchive(d, ids[0]!, NOW);
		expect(names(d, "inbox")[0]).toBe("a");
	});
});

describe("ordering", () => {
	test("move up and down within a section", () => {
		const { d, ids } = setup();
		expect(life.move(d, ids[0]!, -1, NOW)).toBe(true);
		expect(names(d, "inbox")).toEqual(["c", "a", "b"]);
		expect(life.move(d, ids[2]!, -1, NOW)).toBe(false);
		life.snooze(d, ids[1]!, NOW + H, NOW);
		expect(() => life.move(d, ids[1]!, 1, NOW)).toThrow(m.InvalidInput);
	});

	test("drops reorder within a section and transition between sections", () => {
		const { d, ids } = setup(["a", "b", "c", "d"]);
		const [a, b, c, dd] = ids as [number, number, number, number];
		// Inbox is d c b a.
		life.drop(d, a, "inbox", c, NOW);
		expect(names(d, "inbox")).toEqual(["d", "a", "c", "b"]);
		life.drop(d, b, "working", null, NOW);
		expect(m.findTask(d, b).state).toBe("working");
		life.drop(d, c, "working", b, NOW);
		expect(names(d, "working")).toEqual(["c", "b"]);
		life.drop(d, b, "inbox", dd, NOW);
		expect(m.findTask(d, b)).toMatchObject({ state: "inbox", unread: true });
		expect(names(d, "inbox")).toEqual(["b", "d", "a"]);
		life.drop(d, dd, "pinned", null, NOW);
		expect(names(d, "pinned")).toEqual(["d"]);
		life.drop(d, dd, "inbox", null, NOW);
		expect(m.findTask(d, dd).pinned).toBe(false);
		life.drop(d, a, "settled", null, NOW);
		expect(m.findTask(d, a).state).toBe("settled");
		life.drop(d, a, "inbox", b, NOW);
		expect(names(d, "inbox")[0]).toBe("a");
		expect(() => life.drop(d, a, "snoozed", null, NOW)).toThrow(m.InvalidInput);
		life.snooze(d, a, NOW + H, NOW);
		life.drop(d, a, "working", null, NOW);
		expect(m.findTask(d, a)).toMatchObject({ state: "working", unread: false });
	});
});

test("snooze choices are in the future and soonest first", () => {
	const noon = new Date(2026, 10, 14, 12, 0).getTime();
	const choices = life.snoozeChoices(noon);
	expect(choices.map((c) => c.id)).toEqual(["3h", "evening", "tomorrow", "monday"]);
	expect(choices.every((c) => c.until > noon)).toBe(true);
	const late = new Date(2026, 10, 14, 20, 0).getTime();
	expect(life.snoozeChoices(late).map((c) => c.id)).toEqual(["3h", "tomorrow", "monday"]);
	// 14 Nov 2026 is a Saturday: next Monday is the 16th.
	expect(new Date(choices.at(-1)!.until).getDate()).toBe(16);
});
