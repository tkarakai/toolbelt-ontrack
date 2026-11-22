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
		expect([t.state, t.unread, t.unreadReason]).toEqual(["inbox", true, "Back from Progressing"]);
		expect(names(d, "inbox")[0]).toBe("a");
		life.startWorking(d, a, NOW + 3 * H);
		expect(t.unread).toBe(false);
		expect(life.timeSpent(t, NOW + 4 * H)).toBe(3 * H);
		expect(() => life.startWorking(d, a, NOW)).toThrow(m.InvalidInput);
	});

	test("Pinned shows pinned tasks again: they stay at home, wherever that is, settled too", () => {
		const { d, ids } = setup();
		const [a, b] = ids as [number, number];
		life.pin(d, b, NOW);
		expect(names(d, "pinned")).toEqual(["b"]);
		expect(names(d, "inbox")).toEqual(["c", "b", "a"]);
		expect(() => life.pin(d, b, NOW)).toThrow(m.InvalidInput);
		life.startWorking(d, b, NOW);
		expect(life.sectionOf(m.findTask(d, b))).toBe("working");
		expect([names(d, "pinned"), names(d, "working")]).toEqual([["b"], ["b"]]);
		life.doneForNow(d, b, NOW);
		life.unpin(d, b, NOW);
		expect(names(d, "pinned")).toEqual([]);
		expect(names(d, "inbox")[0]).toBe("b");
		// Settling keeps the pin; Settled can be pinned too. Archiving unpins.
		life.pin(d, a, NOW);
		life.settle(d, a, NOW);
		expect([m.findTask(d, a).pinned, names(d, "pinned"), names(d, "settled")]).toEqual([true, ["a"], ["a"]]);
		life.unpin(d, a, NOW);
		life.pin(d, a, NOW);
		life.archive(d, a, NOW);
		expect([m.findTask(d, a).pinned, names(d, "pinned")]).toEqual([false, []]);
	});

	test("Pinned has its own order; drags only reorder it, never pin or unpin", () => {
		const { d, ids } = setup();
		const [a, b, c] = ids as [number, number, number];
		for (const id of [a, b, c]) life.pin(d, id, NOW);
		expect(names(d, "pinned")).toEqual(["a", "b", "c"]);
		life.drop(d, c, "pinned", a, NOW, true);
		expect(names(d, "pinned")).toEqual(["c", "a", "b"]);
		life.move(d, b, -1, NOW, "pinned");
		expect(names(d, "pinned")).toEqual(["c", "b", "a"]);
		// The Inbox order is its own.
		expect(names(d, "inbox")).toEqual(["c", "b", "a"]);
		life.move(d, c, 1, NOW);
		expect(names(d, "inbox")).toEqual(["b", "c", "a"]);
		expect(() => life.drop(d, a, "pinned", null, NOW)).toThrow(m.InvalidInput);
		expect(() => life.drop(d, a, "inbox", null, NOW, true)).toThrow(m.InvalidInput);
		life.unpin(d, a, NOW);
		expect(() => life.move(d, a, 1, NOW, "pinned")).toThrow(m.InvalidInput);
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

describe("watching", () => {
	const D = 24 * H;
	const at = (day: number, hour = 9) => new Date(2026, 10, day, hour, 0).getTime();

	test("watching hides a task until its check-in, then it's on top of the Inbox, unread with why", () => {
		const { d, ids } = setup();
		const [a] = ids as [number];
		life.startWorking(d, a, NOW);
		life.watch(d, a, { on: " Cobra team ", every: life.WEEKLY, next: at(21) }, NOW + H);
		const t = m.findTask(d, a);
		expect(t.state).toBe("watching");
		expect(t.watch).toEqual({ on: "Cobra team", since: NOW + H, every: life.WEEKLY, anchor: at(21), next: at(21), checks: 0 });
		expect(t.sessions.at(-1)!.end).toBe(NOW + H);
		expect(names(d, "watching")).toEqual(["a"]);
		expect(names(d, "inbox")).toEqual(["c", "b"]);
		expect(life.nextWake(d, NOW + H)).toBe(at(21));
		expect(life.tick(d, at(21) - 1)).toBe(false);
		expect(life.tick(d, at(21))).toBe(true);
		expect(t).toMatchObject({ state: "inbox", unread: true, unreadReason: "Time to check in · waiting on Cobra team for 6 days · not checked yet · every week" });
		expect(names(d, "inbox")[0]).toBe("a");
		// Still watched, so Still waiting can send it back.
		expect(t.watch?.on).toBe("Cobra team");
		expect(life.nextWake(d, at(21))).toBeUndefined();
	});

	test("still waiting logs an update and keeps the schedule's day and time", () => {
		const { d, ids } = setup();
		const [a] = ids as [number];
		life.watch(d, a, { on: "Cobra team", every: life.WEEKLY, next: at(21) }, NOW);
		life.tick(d, at(23, 15)); // seen two days late
		life.stillWaiting(d, a, at(23, 15), "Emailed them again.");
		const t = m.findTask(d, a);
		expect(t).toMatchObject({ state: "watching", unread: false, watch: { next: at(28), checked: at(23, 15), checks: 1 } });
		expect(t.updates.at(-1)!.text).toBe("Checked in: still waiting on Cobra team.\n\nEmailed them again.");
		// Checking before the next check-in skips it.
		life.stillWaiting(d, a, at(27));
		expect(t.watch).toMatchObject({ next: at(35), checks: 2 });
		expect(t.updates.at(-1)!.text).toBe("Checked in: still waiting on Cobra team.");
		life.tick(d, at(35));
		expect(t.unreadReason).toBe("Time to check in · waiting on Cobra team for 2 weeks · last checked 8 days ago · every week");
	});

	test("still waiting takes the confirmed date: on schedule keeps it, another restarts it, none ends reminders", () => {
		const { d, ids } = setup();
		const [a] = ids as [number];
		life.watch(d, a, { every: life.WEEKLY, next: at(21) }, NOW);
		const t = m.findTask(d, a);
		// Before the check-in: it hasn't come yet, and the proposal is the one after.
		expect(life.upcomingCheck(t, NOW)).toBe(at(21));
		expect(life.proposedCheck(t, NOW)).toBe(at(28));
		life.stillWaiting(d, a, NOW, "", at(28));
		expect(t.watch).toMatchObject({ next: at(28), anchor: at(21) });
		// Off schedule: weekly from the new date.
		life.stillWaiting(d, a, NOW, "", at(25, 14));
		expect(t.watch).toMatchObject({ next: at(25, 14), anchor: at(25, 14) });
		expect(life.proposedCheck(t, NOW)).toBe(at(32, 14));
		expect(() => life.stillWaiting(d, a, NOW, "", NOW - 1)).toThrow(m.InvalidInput);
		life.stillWaiting(d, a, NOW, "", null);
		expect(t.watch).toMatchObject({ checks: 3 });
		expect([t.watch?.next, t.watch?.every, t.watch?.anchor]).toEqual([undefined, undefined, undefined]);
		expect(life.proposedCheck(t, NOW)).toBeUndefined();
	});

	test("monthly check-ins keep their day, clamped at month ends", () => {
		const month = { n: 1, unit: "month" } as const;
		const jan31 = new Date(2027, 0, 31, 9, 0).getTime();
		expect(life.nextCheck(jan31, month, jan31)).toBe(new Date(2027, 1, 28, 9, 0).getTime());
		expect(life.nextCheck(jan31, month, new Date(2027, 1, 28, 9, 0).getTime())).toBe(new Date(2027, 2, 31, 9, 0).getTime());
		expect(life.defaultCheck(NOW)).toBe(at(21));
		expect(life.defaultCheck(NOW, month)).toBe(new Date(2026, 11, 14, 9, 0).getTime());
	});

	test("a one-off check-in asks again in a week; no reminders stays so", () => {
		const { d, ids } = setup();
		const [a, b] = ids as [number, number];
		life.watch(d, a, { next: at(16) }, NOW);
		life.tick(d, at(16));
		life.stillWaiting(d, a, at(16, 10));
		expect(m.findTask(d, a).watch).toMatchObject({ next: at(23), anchor: at(23) });
		expect(m.findTask(d, a).watch?.every).toBeUndefined();
		life.watch(d, b, {}, NOW);
		life.tick(d, NOW + 365 * D);
		expect(m.findTask(d, b).state).toBe("watching");
		life.stillWaiting(d, b, NOW + D);
		expect(m.findTask(d, b).watch).toMatchObject({ checks: 1 });
		expect(m.findTask(d, b).watch?.next).toBeUndefined();
		// Watching sorts by next check-in, no reminders last.
		life.stillWaiting(d, a, NOW + 365 * D);
		expect(names(d, "watching")).toEqual(["a", "b"]);
	});

	test("watching is validated", () => {
		const { d, ids } = setup();
		const [a] = ids as [number];
		expect(() => life.watch(d, a, { next: NOW - 1 }, NOW)).toThrow(m.InvalidInput);
		expect(() => life.watch(d, a, { every: life.WEEKLY }, NOW)).toThrow(m.InvalidInput);
		expect(() => life.watch(d, a, { every: { n: 0, unit: "week" }, next: at(21) }, NOW)).toThrow(m.InvalidInput);
		expect(() => life.stillWaiting(d, a, NOW)).toThrow(m.InvalidInput);
		expect(() => life.stopWatching(d, a, NOW)).toThrow(m.InvalidInput);
		life.watch(d, a, {}, NOW);
		expect(() => life.move(d, a, 1, NOW)).toThrow(m.InvalidInput);
	});

	test("starting work, settling or stopping ends the watch; watching again keeps its history", () => {
		const { d, ids } = setup();
		const [a, b, c] = ids as [number, number, number];
		for (const id of ids) life.watch(d, id, { on: "them", every: life.WEEKLY, next: at(21) }, NOW);
		life.stillWaiting(d, a, NOW + H);
		life.watch(d, a, { on: "someone else", next: at(18) }, NOW + 2 * H);
		expect(m.findTask(d, a).watch).toMatchObject({ on: "someone else", since: NOW, checks: 1, checked: NOW + H, next: at(18) });
		life.startWorking(d, a, NOW + 3 * H);
		expect(m.findTask(d, a).watch).toBeUndefined();
		life.settle(d, b, NOW + 3 * H);
		expect(m.findTask(d, b).watch).toBeUndefined();
		life.stopWatching(d, c, NOW + 3 * H);
		expect(m.findTask(d, c)).toMatchObject({ state: "inbox", unread: false });
		expect(m.findTask(d, c).watch).toBeUndefined();
		expect(names(d, "inbox")[0]).toBe("c");
		// From Settled: keep an eye on it after all.
		life.watch(d, b, {}, NOW + 4 * H);
		expect(m.findTask(d, b).state).toBe("watching");
		expect(m.findTask(d, b).settledAt).toBeUndefined();
	});

	test("a due date arriving brings a watched task back early", () => {
		const { d, ids } = setup();
		const [a] = ids as [number];
		m.updateTask(d, a, { name: "a", due: "2026-11-14 15:00", desc: "", labels: {} }, NOW);
		life.watch(d, a, { on: "Cobra team", every: life.WEEKLY, next: at(21) }, NOW);
		expect(life.nextWake(d, NOW)).toBe(NOW + 3 * H);
		life.tick(d, NOW + 3 * H);
		expect(m.findTask(d, a)).toMatchObject({ state: "inbox", unread: true, unreadReason: "Due now · waiting on Cobra team for less than a day" });
	});

	test("drops in Progressing find the group inside it from the task they land before", () => {
		const { d, ids } = setup(["w1", "w2", "s1", "s2", "x1", "x2"]);
		const [w1, w2, s1, s2, x1, x2] = ids as number[] as [number, number, number, number, number, number];
		life.startWorking(d, w1, NOW);
		life.startWorking(d, w2, NOW);
		life.snooze(d, s1, NOW + H, NOW);
		life.snooze(d, s2, NOW + 2 * H, NOW);
		life.watch(d, x1, { next: at(20) }, NOW);
		life.watch(d, x2, { next: at(21) }, NOW);
		const where = (before: number | null, moving = 99) => life.dropSection(d, "working", before, moving);
		expect(where(w1)).toBe("working");
		expect(where(s1)).toBe("working"); // just above the Snoozed header
		expect(where(s2)).toBe("snoozed");
		expect(where(x1)).toBe("snoozed"); // just above the Watching header
		expect(where(x2)).toBe("watching");
		expect(where(null)).toBe("watching");
		expect(life.dropSection(d, "inbox", s1, 99)).toBe("inbox");
		// Without Watching tasks the end is Snoozed; with neither, Progressing.
		life.stopWatching(d, x1, NOW);
		life.stopWatching(d, x2, NOW);
		expect(where(null)).toBe("snoozed");
		life.wake(d, s1, NOW);
		life.wake(d, s2, NOW);
		expect(where(null)).toBe("working");
		// Reordering within Snoozed is fine; dropping into it from elsewhere isn't.
		life.snooze(d, s1, NOW + H, NOW);
		expect(() => life.drop(d, s1, "snoozed", null, NOW)).not.toThrow();
		expect(() => life.drop(d, w1, "snoozed", null, NOW)).toThrow(m.InvalidInput);
	});

	test("drag into Watching watches weekly (or is Still waiting); out of it stops watching", () => {
		const { d, ids } = setup();
		const [a, b] = ids as [number, number];
		life.drop(d, a, "watching", null, NOW);
		expect(m.findTask(d, a).watch).toMatchObject({ every: life.WEEKLY, next: at(21) });
		life.tick(d, at(21));
		life.drop(d, a, "watching", null, at(21, 10));
		expect(m.findTask(d, a).watch).toMatchObject({ checks: 1, next: at(28) });
		life.drop(d, a, "inbox", b, at(21, 11));
		expect(m.findTask(d, a).watch).toBeUndefined();
		expect(names(d, "inbox")).toEqual(["c", "a", "b"]);
		life.drop(d, b, "watching", null, NOW);
		life.drop(d, b, "inbox", null, NOW);
		expect(m.findTask(d, b).state).toBe("inbox");
		expect(m.findTask(d, b).watch).toBeUndefined();
	});
});
