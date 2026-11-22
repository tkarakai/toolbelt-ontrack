// Where tasks are and how they move, modeled on T3 Code's thread list: Pinned, Inbox, Working,
// Watching, Snoozed and Settled, plus Archive. You play the agent's part today: "Start working on this"
// is sending the agent a message, "Done for now" is the agent finishing its turn. Time and
// relations can mark tasks unread; nothing settles a task except you.
import { addUpdate, CADENCE_UNITS, dueAt, findTask, InvalidInput, type Cadence, type Data, type Order, type Task, type Watch } from "./model";

export const ME = "me";

export type SectionId = "pinned" | "inbox" | "working" | "watching" | "snoozed" | "settled";

/** The section a task shows in (archived tasks show in none). */
export function sectionOf(task: Task): SectionId {
	if (task.state === "settled") return "settled";
	if (task.state === "snoozed") return "snoozed";
	if (task.state === "watching") return "watching";
	if (task.pinned) return "pinned";
	return task.state === "working" ? "working" : "inbox";
}

/**
 * Tasks in a section, in its order: the person's for Pinned/Inbox/Working, next check-in for
 * Watching (no reminder last), wake time for Snoozed, newest first for Settled.
 */
export function inSection(data: Data, section: SectionId): Task[] {
	const tasks = data.tasks.filter((t) => !t.archived && sectionOf(t) === section);
	if (section === "watching") return tasks.sort((a, b) => (a.watch?.next ?? Infinity) - (b.watch?.next ?? Infinity) || (a.watch?.since ?? 0) - (b.watch?.since ?? 0) || a.id - b.id);
	if (section === "snoozed") return tasks.sort((a, b) => (a.snoozedUntil ?? 0) - (b.snoozedUntil ?? 0) || a.id - b.id);
	if (section === "settled") return tasks.sort((a, b) => (b.settledAt ?? 0) - (a.settledAt ?? 0) || b.id - a.id);
	const order = data.order[section];
	const rank = (t: Task) => {
		const i = order.indexOf(t.id);
		return i < 0 ? Number.MAX_SAFE_INTEGER : i;
	};
	return tasks.sort((a, b) => rank(a) - rank(b) || a.id - b.id);
}

const fail = (message: string): never => {
	throw new InvalidInput(message);
};

// ── order ───────────────────────────────────────────────────────────────

const without = (list: number[], id: number) => list.filter((x) => x !== id);

/** Puts `id` into an order list before `before` (the end when null or not listed), visible ids first. */
function place(data: Data, key: keyof Order, id: number, before: number | null) {
	// Keep the list in the order the person sees, so positions mean what they look like.
	const shown = inSection(data, key).map((t) => t.id).filter((x) => x !== id);
	const rest = data.order[key].filter((x) => x !== id && !shown.includes(x));
	const at = before === null ? -1 : shown.indexOf(before);
	shown.splice(at < 0 ? shown.length : at, 0, id);
	data.order[key] = [...shown, ...rest];
}

const toTop = (data: Data, key: keyof Order, id: number) => {
	data.order[key] = [id, ...without(data.order[key], id)];
};

// ── work sessions ───────────────────────────────────────────────────────

function endSession(task: Task, now: number) {
	const open = task.sessions.at(-1);
	if (open && open.end === undefined) open.end = now;
}

/** Total time worked on a task, including a session still running. */
export const timeSpent = (task: Task, now: number) => task.sessions.reduce((sum, s) => sum + Math.max(0, (s.end ?? now) - s.start), 0);

/** When the current work session started, while the task is being worked on. */
export const workingSince = (task: Task) => (task.state === "working" ? task.sessions.at(-1)?.start : undefined);

// ── transitions ─────────────────────────────────────────────────────────

const touch = (task: Task, now: number) => {
	task.updated = now;
};

export function markUnread(task: Task, reason: string) {
	if (task.state === "settled" || task.archived) return;
	task.unread = true;
	task.unreadReason = reason;
}

export function markRead(task: Task) {
	task.unread = false;
	delete task.unreadReason;
}

/** Inbox (or anywhere not Working) → Working: the equivalent of sending the agent a message. */
export function startWorking(data: Data, id: number, now: number, by = ME) {
	const task = findTask(data, id);
	if (task.state === "working") fail("Already working on this.");
	if (task.state === "settled") delete task.settledAt;
	delete task.snoozedUntil;
	// The ball is in your court again: it's no longer watched.
	delete task.watch;
	task.state = "working";
	task.archived = false;
	task.sessions.push({ start: now, by });
	markRead(task);
	toTop(data, "working", id);
	touch(task, now);
}

/** Working → top of the Inbox, unread: the equivalent of the agent finishing its turn. */
export function doneForNow(data: Data, id: number, now: number, before: number | null = null) {
	const task = findTask(data, id);
	if (task.state !== "working") fail("Not being worked on.");
	endSession(task, now);
	task.state = "inbox";
	if (before === null) toTop(data, "inbox", id);
	else place(data, "inbox", id, before);
	markUnread(task, "Back from Working");
	touch(task, now);
}

export function pin(data: Data, id: number, now: number, before: number | null = null) {
	const task = findTask(data, id);
	if (task.state === "settled") fail("Un-settle it first.");
	task.pinned = true;
	task.archived = false;
	place(data, "pinned", id, before);
	touch(task, now);
}

/** Back to its section, where it kept its position. */
export function unpin(data: Data, id: number, now: number) {
	const task = findTask(data, id);
	task.pinned = false;
	data.order.pinned = without(data.order.pinned, id);
	touch(task, now);
}

export function snooze(data: Data, id: number, until: number, now: number) {
	const task = findTask(data, id);
	if (until <= now) fail("Choose a time in the future.");
	if (task.state === "settled") fail("Un-settle it first.");
	endSession(task, now);
	task.state = "snoozed";
	task.snoozedUntil = until;
	touch(task, now);
}

/**
 * Snoozed → top of the Inbox (or back to Pinned). On its own (the time came, or the due date
 * did) it's marked unread; woken by hand, it isn't — you already know.
 */
export function wake(data: Data, id: number, now: number, reason?: string, before: number | null = null) {
	const task = findTask(data, id);
	if (task.state !== "snoozed") fail("Not snoozed.");
	task.state = "inbox";
	delete task.snoozedUntil;
	if (before === null) toTop(data, "inbox", id);
	else place(data, "inbox", id, before);
	if (reason) markUnread(task, reason);
	touch(task, now);
}

/** Done. Settling removes the pin; relations may mark other tasks unread. */
export function settle(data: Data, id: number, now: number) {
	const task = findTask(data, id);
	if (task.state === "settled") fail("Already settled.");
	endSession(task, now);
	task.state = "settled";
	task.settledAt = now;
	task.pinned = false;
	delete task.snoozedUntil;
	delete task.watch;
	markRead(task);
	for (const key of ["pinned", "inbox", "working"] as const) data.order[key] = without(data.order[key], id);
	touch(task, now);
	afterSettle(data, task);
}

/** Settled → top of the Inbox. */
export function unsettle(data: Data, id: number, now: number, before: number | null = null) {
	const task = findTask(data, id);
	if (task.state !== "settled") fail("Not settled.");
	task.state = "inbox";
	delete task.settledAt;
	if (before === null) toTop(data, "inbox", id);
	else place(data, "inbox", id, before);
	touch(task, now);
}

export function archive(data: Data, id: number, now: number) {
	const task = findTask(data, id);
	endSession(task, now);
	if (task.state === "working") task.state = "inbox";
	task.archived = true;
	task.pinned = false;
	markRead(task);
	data.order.pinned = without(data.order.pinned, id);
	touch(task, now);
}

export function unarchive(data: Data, id: number, now: number) {
	const task = findTask(data, id);
	task.archived = false;
	if (task.state === "inbox") toTop(data, "inbox", id);
	touch(task, now);
}

/** Up or down one place within Pinned, Inbox or Working. */
export function move(data: Data, id: number, by: -1 | 1, now: number) {
	const task = findTask(data, id);
	const section = sectionOf(task);
	if (section === "snoozed" || section === "watching" || section === "settled")
		return fail(
			section === "snoozed" ? "Snoozed tasks are ordered by wake time." : section === "watching" ? "Watched tasks are ordered by their next check-in." : "Settled tasks are ordered by when they were settled.",
		);
	const ids = inSection(data, section).map((t) => t.id);
	const i = ids.indexOf(id);
	const j = i + by;
	if (j < 0 || j >= ids.length) return false;
	[ids[i], ids[j]] = [ids[j]!, ids[i]!];
	data.order[section] = [...ids, ...data.order[section].filter((x) => !ids.includes(x))];
	touch(task, now);
	return true;
}

/**
 * A drag: into `section` before task `before`. Within a section it reorders; between sections
 * it's the matching transition (Pin, Unpin, Start working, Done for now, Wake, Un-settle,
 * Settle, Watch, Stop watching). Snoozing needs a time, so nothing drops into Snoozed. Dropped
 * into Watching, a task that was already watched goes back with Still waiting; any other is
 * watched weekly, the default schedule.
 */
export function drop(data: Data, id: number, section: SectionId, before: number | null, now: number) {
	const task = findTask(data, id);
	const from = sectionOf(task);
	if (section === "snoozed") fail("Choose Snooze to pick a wake time.");
	if (section === "settled") return from === "settled" ? undefined : settle(data, id, now);
	if (section === "watching") {
		if (from === "watching") return;
		if (task.watch && task.state !== "working") return stillWaiting(data, id, now);
		return watch(data, id, { on: task.watch?.on, every: WEEKLY, next: defaultCheck(now, WEEKLY) }, now);
	}
	if (from === section) {
		place(data, section as keyof Order, id, before);
		return touch(task, now);
	}
	if (from === "settled") unsettle(data, id, now, before);
	if (from === "snoozed") wake(data, id, now, undefined, before);
	if (from === "watching") stopWatching(data, id, now, before);
	if (section === "pinned") return pin(data, id, now, before);
	if (from === "pinned") unpin(data, id, now);
	if (section === "working") {
		if (task.state !== "working") startWorking(data, id, now);
		return place(data, "working", id, before);
	}
	// section === "inbox"
	if (task.state === "working") doneForNow(data, id, now, before);
	else place(data, "inbox", id, before);
}

// ── watching ────────────────────────────────────────────────────────────

export const WEEKLY: Cadence = { n: 1, unit: "week" };

/** `ms` moved on by `k` cadences on the local calendar, keeping the time of day; month ends clamp. */
export function addCadence(ms: number, every: Cadence, k: number): number {
	const d = new Date(ms);
	if (every.unit === "month") {
		const month = d.getMonth() + every.n * k;
		const last = new Date(d.getFullYear(), month + 1, 0).getDate();
		return new Date(d.getFullYear(), month, Math.min(d.getDate(), last), d.getHours(), d.getMinutes()).getTime();
	}
	const days = every.n * k * (every.unit === "week" ? 7 : 1);
	return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, d.getHours(), d.getMinutes()).getTime();
}

/** The first check-in of a repeating schedule after `after`, counted from `anchor`. */
export function nextCheck(anchor: number, every: Cadence, after: number): number {
	for (let k = 0; k < 100_000; k++) {
		const at = addCadence(anchor, every, k);
		if (at > after) return at;
	}
	return fail("That check-in schedule never comes round.");
}

/** The default first check-in: one cadence (a week) from today, at 9:00. */
export function defaultCheck(now: number, every: Cadence = WEEKLY): number {
	const d = new Date(now);
	return addCadence(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9, 0).getTime(), every, 1);
}

/** "Every week", "Every 2 weeks", "Every month". */
export function cadenceLabel(every: Cadence) {
	return every.n === 1 ? `Every ${every.unit}` : `Every ${every.n} ${every.unit}s`;
}

/** A rough length of time: "less than a day", "3 days", "2 weeks", "4 months", "1 year". */
export function duration(ms: number) {
	const days = Math.floor(ms / 86_400_000);
	const n = (count: number, unit: string) => `${count} ${unit}${count === 1 ? "" : "s"}`;
	if (days < 1) return "less than a day";
	if (days < 14) return n(days, "day");
	if (days < 60) return n(Math.floor(days / 7), "week");
	if (days < 365) return n(Math.floor(days / 30), "month");
	return n(Math.floor(days / 365), "year");
}

/** "waiting on Cobra team for 3 weeks", or "watched for 3 weeks". */
export const watchingFor = (w: Watch, now: number) => (w.on ? `waiting on ${w.on} for ${duration(now - w.since)}` : `watched for ${duration(now - w.since)}`);

/** Why a check-in brought a task back, spelled out for its unread line. */
export function checkInReason(w: Watch, now: number) {
	return [
		"Time to check in",
		watchingFor(w, now),
		w.checked !== undefined ? `last checked ${duration(now - w.checked)} ago` : "not checked yet",
		w.every ? cadenceLabel(w.every).toLowerCase() : undefined,
	]
		.filter(Boolean)
		.join(" · ");
}

export type WatchInput = { on?: string; every?: Cadence; next?: number };

function checkCadence(every: Cadence | undefined) {
	if (every === undefined) return undefined;
	if (!Number.isInteger(every.n) || every.n < 1 || every.n > 366 || !CADENCE_UNITS.includes(every.unit)) fail("Choose how often to check in.");
	return { n: every.n, unit: every.unit };
}

/**
 * Watch a task: out of your hands for now. With `next` it comes back to the Inbox then (and,
 * with `every`, on that schedule); without, only when you look. From Settled too ("keep an eye
 * on it after all"). Watching it again keeps when it started and how often it was checked.
 */
export function watch(data: Data, id: number, input: WatchInput, now: number) {
	const task = findTask(data, id);
	const every = checkCadence(input.every);
	if (input.next !== undefined && input.next <= now) fail("Choose a check-in time in the future.");
	if (every && input.next === undefined) fail("Choose when to check in first.");
	const on = input.on?.trim().slice(0, 200);
	endSession(task, now);
	if (task.state === "settled") delete task.settledAt;
	delete task.snoozedUntil;
	const was = task.watch;
	const w: Watch = { since: was?.since ?? now, checks: was?.checks ?? 0 };
	if (on) w.on = on;
	if (every) w.every = every;
	if (input.next !== undefined) w.anchor = w.next = input.next;
	if (was?.checked !== undefined) w.checked = was.checked;
	task.watch = w;
	task.state = "watching";
	markRead(task);
	touch(task, now);
}

/**
 * You checked, and it's still in someone else's hands: logged as an update (with your note, if
 * any), and back to Watching until the next check-in. A repeating watch keeps its schedule (a
 * check before the next one skips it); a one-off asks again in a week; no reminder stays so.
 */
export function stillWaiting(data: Data, id: number, now: number, note = "") {
	const task = findTask(data, id);
	const w = task.watch ?? fail("This task isn't watched.");
	if (task.state === "settled") fail("Un-settle it first.");
	if (w.every && w.anchor !== undefined) w.next = nextCheck(w.anchor, w.every, Math.max(now, task.state === "watching" ? (w.next ?? now) : now));
	else if (w.next !== undefined) w.anchor = w.next = defaultCheck(now);
	w.checked = now;
	w.checks++;
	const text = `Checked in: still waiting${w.on ? ` on ${w.on}` : ""}.`;
	addUpdate(data, id, note.trim() ? `${text}\n\n${note.trim()}` : text, now);
	endSession(task, now);
	delete task.snoozedUntil;
	task.state = "watching";
	markRead(task);
	touch(task, now);
}

/** No longer watched. A task in Watching goes to the top of the Inbox (or `before`), read. */
export function stopWatching(data: Data, id: number, now: number, before: number | null = null) {
	const task = findTask(data, id);
	if (!task.watch) fail("This task isn't watched.");
	delete task.watch;
	if (task.state === "watching") {
		task.state = "inbox";
		if (before === null) toTop(data, "inbox", id);
		else place(data, "inbox", id, before);
	}
	touch(task, now);
}

/** A check-in came due: back to the top of the Inbox, unread with why, still watched. */
function surface(data: Data, task: Task, now: number, reason: string) {
	task.state = "inbox";
	toTop(data, "inbox", task.id);
	markUnread(task, reason);
	touch(task, now);
}

// ── things that happen on their own ─────────────────────────────────────

/** Tasks a task blocks, and its parent: relations read from the task that holds them. */
const blockersOf = (data: Data, id: number) => data.tasks.filter((t) => t.relations.some((r) => r.type === "blocks" && r.task === id));
const childrenOf = (data: Data, id: number) => data.tasks.filter((t) => t.relations.some((r) => r.type === "parent" && r.task === id));

function afterSettle(data: Data, settled: Task) {
	// Tasks it blocked, now that nothing else blocks them.
	for (const r of settled.relations.filter((r) => r.type === "blocks")) {
		const blocked = data.tasks.find((t) => t.id === r.task);
		if (blocked && blockersOf(data, blocked.id).every((b) => b.state === "settled")) markUnread(blocked, `Unblocked: #${settled.id} is settled`);
	}
	// Its parent, once every child is settled.
	for (const r of settled.relations.filter((r) => r.type === "parent")) {
		const parent = data.tasks.find((t) => t.id === r.task);
		if (parent && childrenOf(data, parent.id).every((c) => c.state === "settled")) markUnread(parent, "All subtasks are settled");
	}
}

/**
 * Snoozes that ended, check-ins that came due and due dates that arrived since the last look. A due date arriving wakes
 * a snoozed task early, as T3 Code wakes a thread that needs you. Returns whether anything changed.
 */
export function tick(data: Data, now: number): boolean {
	let changed = false;
	for (const task of data.tasks) {
		if (task.archived || task.state === "settled") continue;
		const due = task.due && task.dueAnnounced !== task.due && dueAt(task.due) <= now ? task.due : undefined;
		if (task.state === "snoozed" && (task.snoozedUntil! <= now || due)) {
			wake(data, task.id, now, due ? "Due now" : "Snooze ended");
			changed = true;
		} else if (task.state === "watching" && ((task.watch?.next !== undefined && task.watch.next <= now) || due)) {
			surface(data, task, now, due ? `Due now · ${watchingFor(task.watch!, now)}` : checkInReason(task.watch!, now));
			changed = true;
		} else if (due) {
			markUnread(task, "Due now");
			changed = true;
		}
		if (due) task.dueAnnounced = due;
	}
	return changed;
}

/** The next moment `tick` has something to do, if any. */
export function nextWake(data: Data, now: number): number | undefined {
	let next: number | undefined;
	for (const t of data.tasks) {
		if (t.archived || t.state === "settled") continue;
		const times = [t.state === "snoozed" ? t.snoozedUntil : undefined, t.state === "watching" ? t.watch?.next : undefined, t.due && t.dueAnnounced !== t.due ? dueAt(t.due) : undefined];
		for (const at of times) if (at !== undefined && at > now && (next === undefined || at < next)) next = at;
	}
	return next;
}

// ── snooze choices ──────────────────────────────────────────────────────

/** Snooze menu choices, soonest first; "this evening" only while it's still ahead. */
export function snoozeChoices(now: number): { id: string; label: string; until: number }[] {
	const d = new Date(now);
	const at = (days: number, hour: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, hour, 0).getTime();
	const monday = (8 - d.getDay()) % 7 || 7;
	const choices = [
		{ id: "3h", label: "3 hours", until: now + 3 * 3_600_000 },
		{ id: "evening", label: "This evening", until: at(0, 18) },
		{ id: "tomorrow", label: "Tomorrow 9:00", until: at(1, 9) },
		{ id: "monday", label: "Next Monday 9:00", until: at(monday, 9) },
	];
	return choices.filter((c) => c.until > now + 30 * 60_000 || c.id === "3h").sort((a, b) => a.until - b.until);
}
