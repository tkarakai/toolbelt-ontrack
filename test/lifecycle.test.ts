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
		life.transition(d, a, "working", {}, NOW);
		expect(names(d, "working")).toEqual(["a"]);
		expect(life.workingSince(m.findTask(d, a))).toBe(NOW);
		life.transition(d, a, "inbox", {}, NOW + 2 * H);
		const t = m.findTask(d, a);
		expect([t.state, t.unread, t.unreadReason]).toEqual(["inbox", true, "Back from Working on it"]);
		expect(names(d, "inbox")[0]).toBe("a");
		life.transition(d, a, "working", {}, NOW + 3 * H);
		expect(t.unread).toBe(false);
		expect(life.timeSpent(t, NOW + 4 * H)).toBe(3 * H);
		expect(() => life.transition(d, a, "working", {}, NOW)).toThrow(m.InvalidInput);
	});

	test("snooze hides a task until it wakes, then it's on top and unread", () => {
		const { d, ids } = setup();
		const [a] = ids as [number];
		life.transition(d, a, "snoozed", { until: NOW + H }, NOW);
		expect(names(d, "snoozed")).toEqual(["a"]);
		expect(life.nextWake(d, NOW)).toBe(NOW + H);
		expect(life.tick(d, NOW + H - 1)).toBe(false);
		expect(life.tick(d, NOW + H)).toBe(true);
		const t = m.findTask(d, a);
		expect([t.state, t.unread, t.unreadReason, t.snoozedUntil]).toEqual(["inbox", true, "Snooze ended", undefined]);
		expect(names(d, "inbox")[0]).toBe("a");
		expect(() => life.transition(d, a, "snoozed", { until: NOW - 1 }, NOW)).toThrow(m.InvalidInput);
	});

	test("everything P brings back to the Inbox is unread, saying why", () => {
		const { d, ids } = setup();
		const [a, b, c] = ids as [number, number, number];
		life.transition(d, a, "snoozed", { until: NOW + H }, NOW);
		life.transition(d, a, "inbox", {}, NOW);
		life.transition(d, b, "settled", {}, NOW);
		life.transition(d, b, "inbox", {}, NOW);
		life.transition(d, c, "watching", { watch: {} }, NOW);
		life.transition(d, c, "inbox", {}, NOW);
		expect([a, b, c].map((id) => m.findTask(d, id).unreadReason)).toEqual(["Back from Snoozed", "Reopened from Settled", "Back from Watching"]);
		// Starting work reads it: you just chose it.
		life.transition(d, a, "working", {}, NOW);
		expect(m.findTask(d, a).unread).toBe(false);
	});

	test("a due date arriving wakes a snoozed task early and marks open tasks unread once", () => {
		const { d, ids } = setup();
		const [a, b] = ids as [number, number];
		m.updateTask(d, a, { name: "a", due: "2026-11-14 13:00", desc: "", labels: {} }, NOW);
		m.updateTask(d, b, { name: "b", due: "2026-11-14 13:30", desc: "", labels: {} }, NOW);
		life.transition(d, a, "snoozed", { until: NOW + 10 * H }, NOW);
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
		life.transition(d, ids[0]!, "settled", {}, NOW);
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
		life.transition(d, blocker, "settled", {}, NOW);
		expect(m.findTask(d, blocked)).toMatchObject({ unread: true, unreadReason: `Unblocked: #${blocker} is settled` });
		life.transition(d, c1, "settled", {}, NOW);
		expect(m.findTask(d, parent).unread).toBe(false);
		life.transition(d, c2, "settled", {}, NOW);
		expect(m.findTask(d, parent)).toMatchObject({ unread: true, unreadReason: "All subtasks are settled" });
	});

	test("settled shows newest first and un-settle returns to the top of the Inbox", () => {
		const { d, ids } = setup();
		const [a, b] = ids as [number, number];
		life.transition(d, a, "settled", {}, NOW);
		life.transition(d, b, "settled", {}, NOW + 1);
		expect(names(d, "settled")).toEqual(["b", "a"]);
		life.transition(d, a, "inbox", {}, NOW);
		expect(names(d, "inbox")[0]).toBe("a");
	});

	test("archive hides a task from every section", () => {
		const { d, ids } = setup();
		life.transition(d, ids[0]!, "working", {}, NOW);
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
		life.transition(d, ids[1]!, "snoozed", { until: NOW + H }, NOW);
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
		life.transition(d, a, "snoozed", { until: NOW + H }, NOW);
		// Strict: Snoozed can't jump to Working on it; P back to the Inbox first.
		expect(() => life.drop(d, a, "working", null, NOW)).toThrow("Bring it back to the Inbox first (P), then start working on it.");
		life.drop(d, a, "inbox", null, NOW);
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
		life.transition(d, a, "working", {}, NOW);
		life.transition(d, a, "watching", { watch: { on: " Cobra team ", every: life.WEEKLY, next: at(21) } }, NOW + H);
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

	test("watching a task a check-in brought back logs the check and keeps the schedule's day and time", () => {
		const { d, ids } = setup();
		const [a] = ids as [number];
		life.transition(d, a, "watching", { watch: { on: "Cobra team", every: life.WEEKLY, next: at(21) } }, NOW);
		life.tick(d, at(23, 15)); // seen two days late
		const t = m.findTask(d, a);
		expect(life.nextOnSchedule(t, at(23, 15))).toBe(at(28));
		life.transition(d, a, "watching", { watch: { on: "Cobra team", every: life.WEEKLY, next: at(28), note: "Emailed them again." } }, at(23, 15));
		expect(t).toMatchObject({ state: "watching", unread: false, watch: { next: at(28), anchor: at(21), since: NOW, checked: at(23, 15), checks: 1 } });
		expect(t.updates.at(-1)!.text).toBe("Checked in: still waiting on Cobra team.\n\nEmailed them again.");
		// Changing the watch while it's in Watching isn't a check.
		life.transition(d, a, "watching", { watch: { on: "Cobra support", every: life.WEEKLY, next: at(28) } }, at(24));
		expect(t.watch).toMatchObject({ on: "Cobra support", checks: 1 });
		expect(t.updates).toHaveLength(1);
		// Off the schedule: weekly from the new date.
		life.tick(d, at(28));
		life.transition(d, a, "watching", { watch: { every: life.WEEKLY, next: at(30, 14) } }, at(28, 10));
		expect(t.watch).toMatchObject({ next: at(30, 14), anchor: at(30, 14), checks: 2 });
		expect(t.updates.at(-1)!.text).toBe("Checked in: still waiting.");
		life.tick(d, at(30, 14));
		expect(t.unreadReason).toBe("Time to check in · watched for 2 weeks · last checked 2 days ago · every week");
	});

	test("monthly check-ins keep their day, clamped at month ends", () => {
		const month = { n: 1, unit: "month" } as const;
		const jan31 = new Date(2027, 0, 31, 9, 0).getTime();
		expect(life.nextCheck(jan31, month, jan31)).toBe(new Date(2027, 1, 28, 9, 0).getTime());
		expect(life.nextCheck(jan31, month, new Date(2027, 1, 28, 9, 0).getTime())).toBe(new Date(2027, 2, 31, 9, 0).getTime());
		expect(life.defaultCheck(NOW)).toBe(at(21));
		expect(life.defaultCheck(NOW, month)).toBe(new Date(2026, 11, 14, 9, 0).getTime());
	});

	test("a one-off check-in proposes a week from then; no reminders proposes none", () => {
		const { d, ids } = setup();
		const [a, b] = ids as [number, number];
		life.transition(d, a, "watching", { watch: { next: at(16) } }, NOW);
		life.tick(d, at(16));
		expect(life.nextOnSchedule(m.findTask(d, a), at(16, 10))).toBe(at(23));
		life.transition(d, b, "watching", { watch: {} }, NOW);
		life.tick(d, NOW + 365 * D);
		expect(m.findTask(d, b).state).toBe("watching");
		expect(life.nextOnSchedule(m.findTask(d, b), NOW)).toBeUndefined();
		// A task never watched proposes the default: a week from today at 9:00.
		expect(life.nextOnSchedule(m.findTask(d, ids[2]!), NOW)).toBe(at(21));
		// Watching sorts by next check-in, no reminders last.
		life.transition(d, a, "watching", { watch: { next: at(23) } }, at(16, 10));
		expect(names(d, "watching")).toEqual(["a", "b"]);
	});

	test("watching is validated", () => {
		const { d, ids } = setup();
		const [a] = ids as [number];
		expect(() => life.transition(d, a, "watching", { watch: { next: NOW - 1 } }, NOW)).toThrow(m.InvalidInput);
		expect(() => life.transition(d, a, "watching", { watch: { every: life.WEEKLY } }, NOW)).toThrow(m.InvalidInput);
		expect(() => life.transition(d, a, "watching", { watch: { every: { n: 0, unit: "week" }, next: at(21) } }, NOW)).toThrow(m.InvalidInput);
		expect(() => life.transition(d, a, "inbox", {}, NOW)).toThrow(m.InvalidInput);
		life.transition(d, a, "watching", { watch: {} }, NOW);
		expect(() => life.move(d, a, 1, NOW)).toThrow(m.InvalidInput);
		// The state machine: no Z from Watching or Settled; P brings it back first.
		expect(() => life.transition(d, a, "snoozed", { until: NOW + H }, NOW)).toThrow("Stop watching it first (P), then snooze it.");
		life.transition(d, a, "settled", {}, NOW);
		expect(() => life.transition(d, a, "snoozed", { until: NOW + H }, NOW)).toThrow("Reopen it first (P), then snooze it.");
	});

	test("starting work, settling or stopping ends the watch; watching again keeps its history", () => {
		const { d, ids } = setup();
		const [a, b, c] = ids as [number, number, number];
		for (const id of ids) life.transition(d, id, "watching", { watch: { on: "them", every: life.WEEKLY, next: at(21) } }, NOW);
		life.tick(d, at(21));
		life.transition(d, a, "watching", { watch: { on: "someone else", next: at(25) } }, at(21, 10));
		expect(m.findTask(d, a).watch).toMatchObject({ on: "someone else", since: NOW, checks: 1, checked: at(21, 10), next: at(25) });
		// Its next check-in brings it back, still watched; starting work then ends the watch.
		life.tick(d, at(25));
		expect(m.findTask(d, a).watch).toBeDefined();
		life.transition(d, a, "working", {}, at(25));
		expect(m.findTask(d, a).watch).toBeUndefined();
		life.transition(d, b, "settled", {}, at(21, 11));
		expect(m.findTask(d, b).watch).toBeUndefined();
		life.transition(d, c, "watching", { watch: { on: "them", every: life.WEEKLY, next: at(28) } }, at(21, 11));
		life.transition(d, c, "inbox", {}, at(21, 12));
		expect(m.findTask(d, c)).toMatchObject({ state: "inbox", unread: true, unreadReason: "Back from Watching" });
		expect(m.findTask(d, c).watch).toBeUndefined();
		expect(names(d, "inbox")[0]).toBe("c");
		// From Settled: keep an eye on it after all.
		life.transition(d, b, "watching", { watch: {} }, at(21, 13));
		expect(m.findTask(d, b).state).toBe("watching");
		expect(m.findTask(d, b).settledAt).toBeUndefined();
	});

	test("a due date arriving brings a watched task back early", () => {
		const { d, ids } = setup();
		const [a] = ids as [number];
		m.updateTask(d, a, { name: "a", due: "2026-11-14 15:00", desc: "", labels: {} }, NOW);
		life.transition(d, a, "watching", { watch: { on: "Cobra team", every: life.WEEKLY, next: at(21) } }, NOW);
		expect(life.nextWake(d, NOW)).toBe(NOW + 3 * H);
		life.tick(d, NOW + 3 * H);
		expect(m.findTask(d, a)).toMatchObject({ state: "inbox", unread: true, unreadReason: "Due now · waiting on Cobra team for less than a day" });
	});

	test("a drop's section is its state; a drop on Progressing itself starts work", () => {
		const { d, ids } = setup(["w1", "s1"]);
		const [w1, s1] = ids as number[] as [number, number];
		for (const id of ["inbox", "working", "snoozed", "watching", "settled"]) expect(life.dropSection(id)).toBe(id as life.SectionId);
		expect(life.dropSection(life.PROGRESSING)).toBe("working");
		expect(() => life.dropSection("pinned")).toThrow(m.InvalidInput);
		life.transition(d, w1, "working", {}, NOW);
		// Reordering within Snoozed is fine; dropping into it from elsewhere isn't.
		life.transition(d, s1, "snoozed", { until: NOW + H }, NOW);
		expect(() => life.drop(d, s1, "snoozed", null, NOW)).not.toThrow();
		expect(() => life.drop(d, w1, "snoozed", null, NOW)).toThrow(m.InvalidInput);
	});

	test("drops into Watching or Snoozed need a time (the plugin asks); out of Watching stops watching", () => {
		const { d, ids } = setup();
		const [a, b] = ids as [number, number];
		expect(() => life.drop(d, a, "watching", null, NOW)).toThrow(m.InvalidInput);
		expect(() => life.drop(d, a, "snoozed", null, NOW)).toThrow(m.InvalidInput);
		life.transition(d, a, "watching", { watch: { every: life.WEEKLY, next: at(21) } }, NOW);
		expect(() => life.drop(d, a, "watching", null, NOW)).not.toThrow();
		life.drop(d, a, "inbox", b, NOW);
		expect(m.findTask(d, a)).toMatchObject({ state: "inbox", unread: true, unreadReason: "Back from Watching" });
		expect(m.findTask(d, a).watch).toBeUndefined();
		expect(names(d, "inbox")).toEqual(["c", "a", "b"]);
	});
});

describe("the state machine", () => {
	/** A fresh task put in `state` by allowed moves only. */
	function inState(state: m.TaskState) {
		const { d, ids } = setup(["t"]);
		const id = ids[0]!;
		if (state !== "inbox") life.transition(d, id, state, { until: NOW + H, watch: {} }, NOW);
		return { d, id };
	}
	const opts = { until: NOW + 2 * H, watch: {} };

	test("every move in TRANSITIONS works, and every other one is refused without changing anything", () => {
		for (const from of life.STATES)
			for (const to of life.STATES) {
				const { d, id } = inState(from);
				const before = structuredClone(d);
				if (life.canTransition(from, to)) {
					life.transition(d, id, to, opts, NOW + H);
					expect([from, to, m.findTask(d, id).state]).toEqual([from, to, to]);
				} else {
					expect(() => life.transition(d, id, to, opts, NOW + H)).toThrow(m.InvalidInput);
					expect(d).toEqual(before);
				}
			}
	});

	test("the table: P is the way back, Z/W/S go in, and only Snoozed and Watching move to themselves", () => {
		for (const from of life.STATES) {
			const moves = life.TRANSITIONS[from];
			expect(moves.includes("inbox")).toBe(from !== "inbox");
			expect(moves.includes("working")).toBe(from === "inbox");
			expect(moves.includes(from)).toBe(from === "snoozed" || from === "watching");
			expect(moves.includes("watching")).toBe(true);
		}
		expect(life.TRANSITIONS.settled).toEqual(["inbox", "watching"]);
		expect(life.TRANSITIONS.watching).toEqual(["inbox", "watching", "settled"]);
	});

	test("refusals say which key helps; archived tasks don't move", () => {
		const t = (state: m.TaskState) => m.findTask(inState(state).d, 1);
		expect(life.refusal(t("snoozed"), "working")).toBe("Bring it back to the Inbox first (P), then start working on it.");
		expect(life.refusal(t("settled"), "snoozed")).toBe("Reopen it first (P), then snooze it.");
		expect(life.refusal(t("watching"), "snoozed")).toBe("Stop watching it first (P), then snooze it.");
		expect(life.refusal(t("settled"), "settled")).toBe("Already settled.");
		const { d, id } = inState("inbox");
		life.archive(d, id, NOW);
		for (const to of life.STATES) expect(() => life.transition(d, id, to, opts, NOW)).toThrow("Unarchive it first (A).");
	});
});
