// Builds OnTrack's surfaces from the data and the plugin's view state. Pure: given the same
// state and clock it returns the same trees, which the tests rely on.
import { asset, HUES, search, type Action, type Cell, type Dialog as DialogNode, type Field, type Filter, type Node, type Row, type Section, type Tag, type TagKey, type TagValue } from "@toolbelt/sdk";
import { cadenceLabel, defaultCheck, PROGRESSING, duration, inSection, nextOnSchedule, sectionOf, snoozeChoices, STATES, timeSpent, TRANSITIONS, WEEKLY, workingSince, type SectionId } from "./lifecycle";
import { dueAt, relationsOf, shadeOf, toLocalInput, updatesOf, type Cadence, type Data, type Label, type LabelInput, type Task, type TaskInput, type Update, type Watch } from "./model";

export type Dialog =
	| { kind: "task"; id?: number; draft: TaskInput; error?: string }
	| { kind: "relate"; from: number; type: string; to: string; error?: string }
	| { kind: "snooze"; id: number; until: string; error?: string }
	| WatchDialog
	| { kind: "label"; id?: number; draft: Omit<LabelInput, "values" | "shades"> & { values: string; shades: string }; error?: string }
	| { kind: "relationType"; id?: string; name: string; inverse: string; error?: string }
	| { kind: "updates"; id: number; draft: string; editing?: UpdateDraft; error?: string };

/**
 * An update being edited in the Updates dialog: its text and times as the fields show them.
 * `closeAfter`: opened from the details drawer to edit just this one, so saving closes.
 */
export type UpdateDraft = { update: number; text: string; added: string; updated: string; closeAfter?: boolean };

export const updateDraft = (u: Update, closeAfter?: boolean): UpdateDraft => ({ update: u.id, text: u.text, added: toLocalInput(u.added), updated: toLocalInput(u.updated), ...(closeAfter && { closeAfter }) });

export type View = {
	query: string;
	/** Filter id → selected option values. */
	filters: Record<string, string[]>;
	show: "active" | "archived";
	dialog?: Dialog;
};

/**
 * The Watch dialog's fields as shown: who it waits on, a `repeat` choice (see `REPEATS`) and the
 * next check-in as a local datetime. `nextSet`: the person picked the date, so changing the
 * repeat no longer moves it.
 */
export type WatchDialog = { kind: "watch"; id: number; on: string; repeat: string; next: string; nextSet?: boolean; note: string; checkIn?: boolean; error?: string };

/** How often to check in, as the Watch dialog offers it. `once` and `none` have no cadence. */
export const REPEATS: { id: string; label: string; every?: Cadence }[] = [
	{ id: "week", label: "Every week", every: WEEKLY },
	{ id: "2weeks", label: "Every 2 weeks", every: { n: 2, unit: "week" } },
	{ id: "month", label: "Every month", every: { n: 1, unit: "month" } },
	{ id: "3months", label: "Every 3 months", every: { n: 3, unit: "month" } },
	{ id: "day", label: "Every day", every: { n: 1, unit: "day" } },
	{ id: "once", label: "Once" },
	{ id: "none", label: "No reminders: I'll look myself" },
];

const repeatOf = (w: Watch | undefined) => {
	if (!w) return "week";
	if (!w.every) return w.next === undefined ? "none" : "once";
	return REPEATS.find((r) => r.every?.n === w.every!.n && r.every.unit === w.every!.unit)?.id ?? "week";
};

/**
 * The Watch dialog for a task: a new watch (weekly, a week from today at 9:00), the watch of a
 * task in Watching, or (`checkIn`) a task a check-in brought back: watching it again proposes
 * the next date on its schedule and takes a note for the check.
 */
export function watchDialog(task: Task, now: number): WatchDialog {
	const w = task.watch;
	const repeat = repeatOf(w);
	const checkIn = !!w && task.state !== "watching";
	const upcoming = !checkIn && w?.next !== undefined && w.next > now ? w.next : undefined;
	const next = upcoming ?? (checkIn ? nextOnSchedule(task, now) : undefined) ?? defaultCheck(now, REPEATS.find((r) => r.id === repeat)?.every);
	return { kind: "watch", id: task.id, on: w?.on ?? "", repeat, next: toLocalInput(next), note: "", ...(upcoming !== undefined && { nextSet: true }), ...(checkIn && { checkIn }) };
}

/** Check-in quick picks: tomorrow, in 3 days, a week, 2 weeks, a month (each at 9:00). */
function checkPresets(now: number) {
	const d = new Date(now);
	const day = (days: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, 9, 0).getTime();
	return [
		{ label: "Tomorrow 9:00", value: toLocalInput(day(1)) },
		{ label: "In 3 days", value: toLocalInput(day(3)) },
		{ label: "In a week", value: toLocalInput(day(7)) },
		{ label: "In 2 weeks", value: toLocalInput(day(14)) },
		{ label: "In a month", value: toLocalInput(defaultCheck(now, { n: 1, unit: "month" })) },
	];
}

/** A new repeat choice; the next check-in follows it unless the person picked one. */
export function setRepeat(dialog: WatchDialog, repeat: string, now: number) {
	dialog.repeat = repeat;
	if (!dialog.nextSet) dialog.next = toLocalInput(defaultCheck(now, REPEATS.find((r) => r.id === repeat)?.every));
}

export const initialView = (): View => ({ query: "", filters: {}, show: "active" });

const NONE = "__none";

// ── shared helpers ──────────────────────────────────────────────────────

/** The task's labels as colored pills, in label order. Yes/no labels show their name. */
export function tags(data: Data, task: Task): Tag[] {
	return data.labels.flatMap((label) => {
		const value = task.labels[label.id];
		if (value === undefined) return [];
		return [{ text: value === true ? label.name : String(value), color: label.color, tooltip: value === true ? undefined : label.name, shade: shadeOf(label, value) }];
	});
}

/** The description's first line as plain text. */
export const snippet = (markdown: string) =>
	markdown
		.split("\n")
		.find((l) => l.trim())
		?.replace(/^\s*(?:#+|>|[-*+]|\d+\.)\s+/, "")
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/[*_`~]/g, "")
		.trim() || undefined;

/** "1h 25m", "40m", "under a minute". */
export function spent(ms: number) {
	const minutes = Math.floor(ms / 60_000);
	if (minutes < 1) return "under a minute";
	const h = Math.floor(minutes / 60);
	return h ? `${h}h ${minutes % 60}m` : `${minutes}m`;
}

const optionValue = (value: string | boolean) => (value === true ? "yes" : String(value));

/** A text label's listed values, then the other values tasks already use (sorted). */
export function knownValues(data: Data, label: Label): string[] {
	const used = data.tasks.map((t) => t.labels[label.id]).filter((v): v is string => typeof v === "string");
	return [...new Set([...label.values, ...used.sort((a, b) => a.localeCompare(b))])];
}

const filterOptions = (data: Data, label: Label): string[] => (label.type === "bool" ? ["yes"] : knownValues(data, label));

const taskName = (data: Data, id: number) => {
	const task = data.tasks.find((t) => t.id === id);
	return task ? `#${id} ${task.name}` : `#${id}`;
};

/** Overdue: past due and not settled. */
export const isOverdue = (task: Task, now: number) => !!task.due && task.state !== "settled" && dueAt(task.due) < now;

/** The red dot an overdue task carries before its title (red too in the table), in the table and the quick view. */
const overdueDot = (task: Task, now: number) => (isOverdue(task, now) ? { color: "danger" as const, label: "Overdue" } : undefined);

/** "Today", "Tomorrow", "Yesterday", "Fri, Nov 20" or "Fri, Nov 20, 2027", with the time after a dot. */
export function friendlyDue(due: string, now: number): string {
	const [day, time] = due.split("T") as [string, string?];
	const [y, mo, d] = day.split("-").map(Number);
	const date = new Date(y!, mo! - 1, d!);
	const today = new Date(now);
	const days = Math.round((date.getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86_400_000);
	const name =
		days === 0 ? "Today" : days === 1 ? "Tomorrow" : days === -1 ? "Yesterday" : date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", ...(date.getFullYear() !== today.getFullYear() && { year: "numeric" }) });
	if (!time) return name;
	const [h, mi] = time.split(":").map(Number);
	return `${name} · ${new Date(2000, 0, 1, h, mi).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

/** An update's moment: "Nov 14, 9:30 AM", with the year when it isn't this year's. */
export function stamp(ms: number, now: number) {
	const d = new Date(ms);
	return d.toLocaleString(undefined, { month: "short", day: "numeric", ...(d.getFullYear() !== new Date(now).getFullYear() && { year: "numeric" }), hour: "numeric", minute: "2-digit" });
}

/** What the plugin badge counts: open tasks that are unread or overdue. */
export const attention = (data: Data, now: number) => data.tasks.filter((t) => !t.archived && t.state !== "settled" && (t.unread || isOverdue(t, now))).length;

function matches(data: Data, view: View, task: Task, s: ReturnType<typeof search>) {
	for (const [id, values] of Object.entries(view.filters)) {
		if (!values.length) continue;
		const value = task.labels[id.slice("label:".length)];
		if (value === undefined || !values.includes(optionValue(value))) return false;
	}
	return s.test([`#${task.id}`, task.name, task.desc, task.watch?.on ?? "", ...task.updates.map((u) => u.text), ...tags(data, task).map((t) => t.text)]);
}

// ── actions ─────────────────────────────────────────────────────────────

/**
 * Every task action; each row offers the ones that fit its state (`actionsFor`). The state
 * machine: P starts work from the Inbox and brings a task back to the Inbox from anywhere else;
 * Z, W and S put it in Snoozed, Watching or Settled, or change it when it's there. A archives,
 * E edits, R relates, U marks read.
 */
export function taskActions(now: number): Action[] {
	return [
		{ id: "work", label: "Start working on it", icon: "play", key: "p", inline: true, group: "flow" },
		{ id: "done", label: "Done for now", icon: "inbox", key: "p", inline: true, group: "flow" },
		{ id: "wake", label: "Back to Inbox", icon: "inbox", key: "p", inline: true, group: "flow" },
		{ id: "unwatch", label: "Back to Inbox", icon: "inbox", key: "p", inline: true, group: "flow" },
		{ id: "reopen", label: "Back to Inbox", icon: "inbox", key: "p", inline: true, group: "flow" },
		{ id: "settle", label: "Settle", icon: "check", key: "s", group: "flow" },
		{
			id: "snooze",
			label: "Snooze…",
			icon: "alarm-clock",
			key: "z",
			group: "flow",
			menu: snoozeChoices(now).map((c) => ({ id: `snooze:${c.id}`, label: c.label, icon: "alarm-clock" })),
		},
		{ id: "watch", label: "Watch…", icon: "eye", key: "w", group: "flow" },
		// Both go into the details drawer when it's showing; otherwise they open a dialog.
		{ id: "edit", label: "Edit", icon: "pencil", key: "e", group: "edit", focus: "name" },
		{ id: "add-update", label: "Add update", icon: "message-square-plus", key: "shift+u", group: "edit", focus: "update" },
		{ id: "relate", label: "Relate to…", icon: "link", key: "r", group: "edit" },
		{ id: "unrelate", label: "Remove relation", icon: "unlink", group: "edit" },
		{ id: "mark-unread", label: "Mark unread", icon: "mail", key: "u", group: "edit" },
		{ id: "mark-read", label: "Mark read", icon: "mail-open", key: "u", group: "edit" },
		{ id: "up", label: "Move up", icon: "arrow-up", key: "alt+up", group: "order" },
		{ id: "down", label: "Move down", icon: "arrow-down", key: "alt+down", group: "order" },
		{ id: "archive", label: "Archive", icon: "archive", key: "a", group: "other" },
		{ id: "unarchive", label: "Unarchive", icon: "archive-restore", key: "a", group: "other" },
		{ id: "delete", label: "Delete", icon: "trash-2", tone: "destructive", confirm: "Delete this task and its relations?", group: "other" },
	];
}

/** The action ids a task offers, from its state. */
/** The action that moves a task into each state (into the Inbox, by where it comes from). */
const MOVE: Record<Exclude<Task["state"], "inbox">, string> = { working: "work", snoozed: "snooze", watching: "watch", settled: "settle" };
const BACK: Record<Exclude<Task["state"], "inbox">, string> = { working: "done", snoozed: "wake", watching: "unwatch", settled: "reopen" };

/** The action id that makes `task` move to `to` (which `TRANSITIONS` must allow). */
export const actionFor = (task: Task, to: Task["state"]) => (to === "inbox" ? BACK[task.state as Exclude<Task["state"], "inbox">] : MOVE[to]);

/** The action ids a task offers: its moves from `TRANSITIONS` (P, Z, W, S), then the rest. */
export function actionsFor(data: Data, task: Task): string[] {
	if (task.archived) return ["unarchive", "edit", "add-update", "delete"];
	const section = sectionOf(task);
	const ids = TRANSITIONS[task.state].map((to) => actionFor(task, to));
	ids.push("edit", "add-update", "relate");
	if (relationsOf(data, task.id).length) ids.push("unrelate");
	if (task.state !== "settled") ids.push(task.unread ? "mark-read" : "mark-unread");
	if (section === "inbox" || section === "working") ids.push("up", "down");
	ids.push("archive", "delete");
	return ids;
}

// ── tasks screen ────────────────────────────────────────────────────────

/**
 * OnTrack's own icon per state and group (`assets/state-*.svg`, the Hairline set: thin, quiet
 * strokes), used wherever a state shows: section and group headers, drop
 * targets, the When column, the watch mark and the quick view. Actions keep lucide icons.
 */
export const STATE_ICONS = {
	inbox: asset("state-inbox"),
	progressing: asset("state-progressing"),
	working: asset("state-working"),
	snoozed: asset("state-snoozed"),
	watching: asset("state-watching"),
	settled: asset("state-settled"),
};

/**
 * The table's sections. Progressing has no tasks of its own: its tasks show in three
 * sub-sections (`ui.sub-sections`), Working on it, Snoozed and Watching, everything still in
 * motion. Each takes drops as its own move; a drop on Progressing itself starts work.
 */
export const SECTIONS: Section[] = [
	{ id: "inbox", label: "Inbox", icon: STATE_ICONS.inbox, empty: "Inbox zero", dropLabel: "Move to Inbox", dropIcon: STATE_ICONS.inbox },
	{
		id: PROGRESSING,
		label: "Progressing",
		icon: STATE_ICONS.progressing,
		dropLabel: "Start working on it",
		dropIcon: STATE_ICONS.working,
		sections: [
			{ id: "working", label: "Working on it", icon: STATE_ICONS.working, empty: "Nothing you're working on", dropLabel: "Start working on it", dropIcon: STATE_ICONS.working },
			{ id: "snoozed", label: "Snoozed", icon: STATE_ICONS.snoozed, empty: "Nothing snoozed", order: "fixed", dropLabel: "Snooze…", dropIcon: STATE_ICONS.snoozed },
			{ id: "watching", label: "Watching", icon: STATE_ICONS.watching, empty: "Nothing to watch", order: "fixed", dropLabel: "Watch…", dropIcon: STATE_ICONS.watching },
		],
	},
	{ id: "settled", label: "Settled", icon: STATE_ICONS.settled, empty: "Nothing settled yet", collapsed: true, order: "fixed", dropLabel: "Settle", dropIcon: STATE_ICONS.settled },
];

/** Every section's tasks in table order (a nested group shows where its first task is). */
const HOME_ORDER: SectionId[] = ["inbox", "working", "snoozed", "watching", "settled"];

function dueCell(task: Task, now: number): Cell {
	if (!task.due) return null;
	const overdue = isOverdue(task, now);
	return { text: friendlyDue(task.due, now), tone: overdue ? "danger" : undefined, icon: overdue ? "alarm-clock" : undefined };
}

/** "Waiting on Cobra team · 3 weeks · every week · checked 2×": a watched task's second line. */
export function watchLine(w: Watch, now: number) {
	return [
		w.on ? `Waiting on ${w.on}` : "Watching",
		duration(now - w.since),
		w.every ? cadenceLabel(w.every).toLowerCase() : w.next === undefined ? "no reminders" : undefined,
		w.checks ? `checked ${w.checks}×` : undefined,
	]
		.filter(Boolean)
		.join(" · ");
}

/** The moment that matters for the task's section. */
function whenCell(task: Task): Cell {
	if (task.state === "watching") return task.watch?.next !== undefined ? { text: "", at: task.watch.next, icon: STATE_ICONS.watching } : { text: "No reminder", icon: STATE_ICONS.watching, tone: "muted" };
	if (task.state === "snoozed" && task.snoozedUntil) return { text: "", at: task.snoozedUntil, icon: STATE_ICONS.snoozed };
	if (task.state === "settled" && task.settledAt) return { text: "", at: task.settledAt, icon: STATE_ICONS.settled };
	const since = workingSince(task);
	if (since) return { text: "", at: since, icon: STATE_ICONS.working };
	return { text: "", at: task.updated };
}

/** A task's row in its section; an overdue one carries a red dot, one brought back by a check-in an eye mark. */
function taskRow(data: Data, task: Task, now: number): Row {
	const relations = relationsOf(data, task.id);
	const marks = [
		...(task.watch && task.state !== "watching" ? [{ icon: STATE_ICONS.watching, tooltip: task.watch.on ? `Watching: waiting on ${task.watch.on}` : "Watching" }] : []),
	];
	const sub = task.unread && task.unreadReason ? task.unreadReason : task.state === "watching" && task.watch ? watchLine(task.watch, now) : snippet(task.desc);
	return {
		id: String(task.id),
		group: task.archived ? undefined : sectionOf(task),
		unread: task.unread || undefined,
		// The first cell titles the details drawer.
		cells: {
			name: {
				text: task.name,
				dot: overdueDot(task, now),
				tone: isOverdue(task, now) ? "danger" : undefined,
				tags: tags(data, task),
				sub,
				marks: marks.length ? marks : undefined,
			},
			id: { text: `#${task.id}`, mono: true },
			due: dueCell(task, now),
			when: whenCell(task),
		},
		pane: taskPane(data, task, now),
		actions: actionsFor(data, task),
		targets: relations.length
			? { unrelate: relations.map((r) => ({ id: `${r.holder}:${r.type}:${r.inverse ? task.id : r.task}`, label: `${r.label} ${taskName(data, r.task)}`, icon: "link" })) }
			: undefined,
	};
}

/** The status picker's choices: where the task is now (with its moment), and where it can go. */
function statusOptions(task: Task, now: number) {
	const since = workingSince(task);
	const at = (ms: number) => stamp(ms, now);
	// Only the states `TRANSITIONS` allows from here, in list order, and the current one.
	const reachable = (value: string) => value === task.state || TRANSITIONS[task.state].includes(value as Task["state"]);
	return ([
		{ value: "inbox", label: "Inbox" },
		{ value: "working", label: task.state === "working" && since ? `Working on it · since ${at(since)}` : "Working on it" },
		{ value: "snoozed", label: task.state === "snoozed" && task.snoozedUntil ? `Snoozed until ${at(task.snoozedUntil)}` : "Snooze…" },
		{
			value: "watching",
			label: task.state === "watching" ? (task.watch?.next !== undefined ? `Watching · next check-in ${at(task.watch.next)}` : "Watching · no reminders") : "Watching…",
		},
		{ value: "settled", label: task.state === "settled" && task.settledAt ? `Settled ${at(task.settledAt)}` : "Settled" },
	] satisfies { value: (typeof STATES)[number]; label: string }[]).filter((o) => reachable(o.value));
}

/** A watched task's schedule, in full: who, since when, how often, next and last check. */
function watchFacts(task: Task, now: number) {
	const w = task.watch!;
	const at = (ms: number) => stamp(ms, now);
	return [
		w.on ? `Waiting on ${w.on} since ${at(w.since)}` : `Watching since ${at(w.since)}`,
		w.every ? cadenceLabel(w.every) : undefined,
		task.state === "watching" ? (w.next !== undefined ? `next check-in ${at(w.next)}` : "no reminders") : "check-in due",
		w.checked !== undefined ? `checked ${w.checks}×, last ${at(w.checked)}` : "not checked yet",
	]
		.filter(Boolean)
		.join(" · ");
}

/** One quiet line of facts under the properties: id, time spent, when it was made and changed. */
function factsLine(task: Task, now: number) {
	const worked = timeSpent(task, now);
	return [
		`#${task.id}`,
		task.archived ? "Archived" : undefined,
		worked ? `${spent(worked)} worked in ${task.sessions.length} session${task.sessions.length === 1 ? "" : "s"}` : undefined,
		`Created ${stamp(task.created, now)}`,
		task.updated - task.created > 60_000 ? `changed ${stamp(task.updated, now)}` : undefined,
	]
		.filter(Boolean)
		.join(" · ");
}

/**
 * The task's details drawer, edited in place: its name, status, due date, labels and description
 * as a property sheet, then relations, then updates with a composer on top (↵ on the task lands
 * there). Each field saves on its own; nothing is repeated from elsewhere in the drawer.
 */
export function taskPane(data: Data, task: Task, now: number): Node[] {
	const relations = relationsOf(data, task.id);
	const updates = updatesOf(task);
	return [
		...(task.unread && task.unreadReason ? [{ type: "text" as const, text: `New · ${task.unreadReason}`, tone: "info" as const }] : []),
		{
			type: "form",
			id: "task",
			appearance: "inline",
			fields: [
				{ type: "text", id: "name", label: "Name", value: task.name, heading: true, placeholder: "What needs doing" },
				...(task.archived ? [] : [{ type: "select" as const, id: "state", label: "Status", value: task.state, options: statusOptions(task, now) }]),
				{ type: "datetime", id: "due", label: isOverdue(task, now) ? "Overdue" : "Due", value: task.due ?? "", placeholder: "No due date" },
				{ type: "tags", id: "labels", label: "Labels", value: toTagValues(task.labels), keys: tagKeys(data) },
				{ type: "textarea", id: "desc", label: "", value: task.desc, markdown: true, rows: 6, placeholder: "Add a description…" },
			],
		},
		...(task.watch && task.state !== "settled" ? [{ type: "text" as const, text: watchFacts(task, now), tone: "muted" as const }] : []),
		{ type: "text", text: factsLine(task, now), tone: "muted" },
		...(relations.length
			? [
					{
						type: "card" as const,
						id: "related",
						title: `Related · ${relations.length}`,
						actions: [{ id: "relate", label: "Relate to…", icon: "plus" }],
						children: [{ type: "details" as const, items: relations.map((r) => ({ label: r.label, value: taskName(data, r.task) })) }],
					},
				]
			: []),
		{
			type: "card",
			id: "updates",
			title: updates.length ? `Updates · ${updates.length}` : "Updates",
			children: [
				{ type: "composer", id: "update", placeholder: "Add an update… Markdown works", action: { id: "add-update", label: "Add update", icon: "send-horizontal" } },
				{
					type: "timeline",
					id: "updates",
					entries: updates.map((u) => ({ id: String(u.id), at: u.added, edited: u.updated, text: u.text })),
					edit: { id: "edit-update-text", label: "Edit", icon: "pencil", key: "e" },
					actions: [
						{ id: "edit-update", label: "Change times…", icon: "clock" },
						{ id: "delete-update", label: "Delete", icon: "trash-2", tone: "destructive", confirm: "Delete this update?" },
					],
					empty: { title: "No updates yet", description: "Press ↵ on a task to write one.", icon: "history" },
				},
			],
		},
	];
}

export function tasksScreen(data: Data, view: View, now: number): Node {
	const s = search(view.query);
	const archived = view.show === "archived";
	const pool = data.tasks.filter((t) => t.archived === archived);
	const ordered = archived ? [...pool].sort((a, b) => b.updated - a.updated) : HOME_ORDER.flatMap((id) => inSection(data, id));
	const shown = ordered.filter((t) => matches(data, view, t, s));
	const filters: Filter[] = data.labels.map((label) => {
		const counts = new Map<string, number>();
		for (const t of pool) {
			const v = t.labels[label.id];
			if (v !== undefined) counts.set(optionValue(v), (counts.get(optionValue(v)) ?? 0) + 1);
		}
		return {
			id: `label:${label.id}`,
			label: label.name,
			icon: label.type === "bool" ? "toggle-left" : "tag",
			options: filterOptions(data, label).map((value) => ({ value, label: label.type === "bool" ? "Yes" : value, dot: label.color, count: counts.get(value) ?? 0 })),
			selected: view.filters[`label:${label.id}`] ?? [],
		};
	});
	const open = data.tasks.filter((t) => !t.archived && t.state !== "settled" && t.state !== "watching");
	const watching = data.tasks.filter((t) => !t.archived && t.state === "watching").length;
	const unread = open.filter((t) => t.unread).length;
	const summary = archived
		? `${shown.length} archived`
		: `${open.length} open${watching ? ` · ${watching} watching` : ""}${unread ? ` · ${unread} unread` : ""}${shown.length !== ordered.length ? ` · showing ${shown.length}` : ""}`;
	return {
		type: "page",
		search: { placeholder: "Search tasks" },
		summary,
		highlight: s.highlight(),
		filters,
		controls: [
			{
				type: "segmented",
				id: "show",
				label: "Show",
				value: view.show,
				options: [
					{ value: "active", label: "Ongoing", icon: "list-checks" },
					{ value: "archived", label: "Archived", icon: "archive", tooltip: "Archived tasks, newest first" },
				],
			},
		],
		actions: [{ id: "new-task", label: "New task", icon: "plus", primary: true, key: "n" }],
		children: [
			{
				type: "table",
				id: archived ? "archived" : "tasks",
				columns: [
					// The first column titles the details drawer, so it's the name.
					{ key: "name", title: "Task", grow: true },
					{ key: "id", title: "#", mono: true, width: 64, priority: 4 },
					{ key: "due", title: "Due", width: 176, priority: 2 },
					{ key: "when", title: "When", width: 120, priority: 3 },
				],
				appearance: "document",
				...(archived ? {} : { sections: SECTIONS, reorder: true }),
				selectEvents: true,
				// ↵ on a task writes an update in its drawer.
				enter: "add-update",
				rows: shown.map((t) => taskRow(data, t, now)),
				actions: taskActions(now),
				empty: archived
					? { title: "Nothing archived", description: "Archive tasks you want out of sight but not deleted.", icon: "archive" }
					: data.tasks.length
						? { title: "No matching tasks", description: "Change the search or filters.", icon: "search-x" }
						: { title: "No tasks yet", description: "Create one with New task (N).", icon: "list-checks" },
			},
		],
		dialog: view.dialog &&["task", "relate", "snooze", "watch", "updates"].includes(view.dialog.kind) ? dialogNode(data, view.dialog, now) : undefined,
	};
}

// ── settings screen ─────────────────────────────────────────────────────

/** Labels and relation types, each table with its own New button above it. */
export function settingsScreen(data: Data, view: View, now: number): Node {
	const uses = (label: Label) => data.tasks.filter((t) => t.labels[label.id] !== undefined).length;
	return {
		type: "page",
		summary: `${data.labels.length} labels · ${data.relationTypes.length} relation types`,
		children: [
			{
				type: "card",
				id: "labels",
				title: "Labels",
				description: "Colored attributes a task can carry, one value each.",
				actions: [{ id: "new-label", label: "New label", icon: "tag", primary: true }],
				children: [
					{
						type: "table",
						id: "labels",
						columns: [
							{ key: "name", title: "Label", grow: true },
							{ key: "type", title: "Type", width: 90 },
							{ key: "values", title: "Values", grow: 2, minWidth: 160 },
							{ key: "uses", title: "Tasks", align: "right", width: 70 },
						],
						rows: data.labels.map((label) => ({
							id: `l${label.id}`,
							cells: {
								name: { text: label.name, dot: label.color },
								type: label.type === "bool" ? "Yes/no" : label.freeform ? "Free text" : "Lookup",
								values: label.values.length
									? {
											text: "",
											tags: label.values.map((v) => ({ text: v, color: label.color, shade: shadeOf(label, v) })),
											sub: label.freeform ? "suggestions" : undefined,
										}
									: { text: label.type === "bool" ? "—" : "any text", tone: "muted" },
								uses: uses(label),
							},
						})),
						actions: [
							{ id: "edit-label", label: "Edit", icon: "pencil", key: "e", inline: true },
							{ id: "delete-label", label: "Delete", icon: "trash-2", tone: "destructive", confirm: "Delete this label and remove it from every task?" },
						],
						empty: { title: "No labels", description: "Create one with New label.", icon: "tag" },
					},
				],
			},
			{
				type: "card",
				id: "relation-types",
				title: "Relation types",
				description: "How one task can relate to another, read from both sides.",
				actions: [{ id: "new-relation-type", label: "New relation type", icon: "link" }],
				children: [
					{
						type: "table",
						id: "relation-types",
						columns: [
							{ key: "name", title: "Relation", grow: true },
							{ key: "inverse", title: "Read from the other task", grow: true },
							{ key: "uses", title: "Uses", align: "right", width: 70 },
						],
						rows: data.relationTypes.map((t) => ({
							id: `r${t.id}`,
							cells: {
								name: { text: t.name, sub: t.id },
								inverse: t.inverse,
								uses: data.tasks.reduce((n, task) => n + task.relations.filter((r) => r.type === t.id).length, 0),
							},
						})),
						actions: [
							{ id: "edit-relation-type", label: "Edit", icon: "pencil", key: "e", inline: true },
							{ id: "delete-relation-type", label: "Delete", icon: "trash-2", tone: "destructive", confirm: "Delete this relation type?" },
						],
						empty: { title: "No relation types", icon: "link" },
					},
				],
			},
		],
		dialog: view.dialog && ["label", "relationType"].includes(view.dialog.kind) ? dialogNode(data, view.dialog, now) : undefined,
	};
}

// ── dialogs ─────────────────────────────────────────────────────────────

/** Labels as the pill editor's keys: yes/no labels are flags, lookups pick from their values. */
/**
 * Labels as the pill editor's keys: yes/no labels are flags, lookups pick from their values.
 * Free-text labels also suggest the values other tasks already have (an existing project).
 */
export function tagKeys(data: Data): TagKey[] {
	return data.labels.map((l) => {
		if (l.type === "bool") return { key: String(l.id), label: l.name, color: l.color, flag: true };
		const shades = Object.fromEntries(l.values.flatMap((v) => { const shade = shadeOf(l, v); return shade === undefined ? [] : [[v, shade]]; }));
		return {
			key: String(l.id),
			label: l.name,
			color: l.color,
			values: l.freeform ? knownValues(data, l) : l.values,
			freeform: l.freeform,
			...(Object.keys(shades).length && { shades }),
		};
	});
}

export const toTagValues = (labels: Task["labels"]): TagValue[] =>
	Object.entries(labels).map(([key, value]) => (value === true ? { key } : { key, value: String(value) }));

export const fromTagValues = (values: TagValue[]): Task["labels"] => Object.fromEntries(values.map((v) => [v.key, v.value === undefined ? true : v.value]));

export const fieldValue = (value: unknown) => (value === NONE ? "" : value);

const save: Action = { id: "save", label: "Save", primary: true };
const error = (text?: string): Node[] => (text ? [{ type: "text", text, tone: "danger" }] : []);

/** The Snooze dialog for a task: its current wake time while snoozed, else tomorrow at 9:00. */
export function snoozeDialog(task: Task, now: number): Extract<Dialog, { kind: "snooze" }> {
	const until = task.state === "snoozed" && task.snoozedUntil && task.snoozedUntil > now ? toLocalInput(task.snoozedUntil) : defaultSnooze(now);
	return { kind: "snooze", id: task.id, until };
}

/** The default custom snooze: tomorrow at 9:00, local time. */
export function defaultSnooze(now: number) {
	const d = new Date(now);
	const t = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
	return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}T09:00`;
}

function dialogNode(data: Data, dialog: Dialog, now: number): DialogNode {
	switch (dialog.kind) {
		case "task": {
			const d = dialog.draft;
			return {
				id: "task",
				title: dialog.id ? `Edit #${dialog.id}` : "New task",
				wide: true,
				resizable: true,
				actions: [save],
				children: [
					...error(dialog.error),
					{
						type: "form",
						id: "task",
						fields: [
							{ type: "text", id: "name", label: "Name", value: d.name, placeholder: "What needs doing" },
							{ type: "datetime", id: "due", label: "Due", value: d.due, placeholder: "No due date", description: "Optional. Without a time, it's due at the end of the day." },
							{ type: "tags", id: "labels", label: "Labels", value: toTagValues(d.labels), keys: tagKeys(data) },
							{ type: "textarea", id: "desc", label: "Description", value: d.desc, markdown: true, rows: 8, placeholder: "Markdown: # heading, **bold**, - list, [link](https://…)" },
						],
					},
				],
			};
		}
		case "relate": {
			const others = data.tasks.filter((t) => t.id !== dialog.from);
			return {
				id: "relate",
				title: `Relate ${taskName(data, dialog.from)}`,
				actions: [{ ...save, label: "Relate", disabled: !dialog.to }],
				children: [
					...error(dialog.error),
					{
						type: "form",
						id: "relate",
						fields: [
							{
								type: "select",
								id: "type",
								label: "Relation",
								description: "As it will read on this task: Parent, Child, Blocked by…",
								value: dialog.type,
								options: data.relationTypes.flatMap((t) =>
									t.inverse === t.name ? [{ value: t.id, label: t.name }] : [{ value: t.id, label: t.name }, { value: `~${t.id}`, label: t.inverse }],
								),
							},
							{
								type: "combobox",
								id: "to",
								label: "Task",
								value: dialog.to,
								placeholder: others.length ? "Choose a task" : "No other tasks",
								options: others.map((t) => ({ value: String(t.id), label: t.name, sub: `#${t.id}${t.state === "settled" ? " · settled" : ""}` })),
							},
						],
					},
				],
			};
		}
		case "snooze": {
			const choices = snoozeChoices(now);
			return {
				id: "snooze",
				title: `Snooze ${taskName(data, dialog.id)}`,
				description: "It comes back to the top of the Inbox, marked unread.",
				actions: [{ ...save, label: "Snooze", disabled: !dialog.until }],
				children: [
					...error(dialog.error),
					{
						type: "form",
						id: "snooze",
						fields: [
							{
								type: "datetime",
								id: "until",
								label: "Until",
								value: dialog.until,
								placeholder: "Pick when it comes back",
								presets: choices.map((c) => ({ label: c.label, value: toLocalInput(c.until) })),
								description: "A date alone means 9:00 that day.",
							},
						],
					},
				],
			};
		}
		case "watch": {
			const repeat = REPEATS.find((r) => r.id === dialog.repeat);
			const known = [...new Set(data.tasks.map((t) => t.watch?.on).filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b));
			const presets = checkPresets(now);
			return {
				id: "watch",
				title: dialog.checkIn ? `Check in · ${taskName(data, dialog.id)}` : `Watch ${taskName(data, dialog.id)}`,
				description: dialog.checkIn
					? "Still waiting? It goes back to Watching until the next check-in, proposed on its schedule. The check is logged as an update."
					: "Out of your hands for now. At each check-in it comes back to the top of the Inbox, unread, saying why; W sends it back here, P keeps it in the Inbox.",
				actions: [{ ...save, label: dialog.checkIn ? "Keep watching" : "Watch" }],
				children: [
					...error(dialog.error),
					{
						type: "form",
						id: "watch",
						fields: [
							{
								type: "combobox",
								id: "on",
								label: "Waiting on",
								value: dialog.on,
								freeform: true,
								placeholder: "Who or what (optional)",
								options: known.map((v) => ({ value: v, label: v })),
							},
							{ type: "select", id: "repeat", label: "Check in", value: dialog.repeat, options: REPEATS.map((r) => ({ value: r.id, label: r.label })) },
							...(dialog.repeat === "none"
								? []
								: [
										{
											type: "datetime" as const,
											id: "next",
											label: dialog.checkIn ? "Next check-in" : repeat?.every ? "First check-in" : "Check in on",
											value: dialog.next,
											placeholder: "Pick when to check in",
											presets,
											description: repeat?.every ? `Then ${cadenceLabel(repeat.every).toLowerCase()}, on the same day and time. A date alone means 9:00.` : "A date alone means 9:00 that day.",
										},
									]),
							...(dialog.checkIn
								? [{ type: "textarea" as const, id: "note", label: "Anything new?", value: dialog.note, markdown: true, rows: 3, placeholder: "Optional. Saved with the check in the updates." }]
								: []),
						],
					},
				],
			};
		}
		case "label": {
			const d = dialog.draft;
			return {
				id: "label",
				title: dialog.id ? `Edit ${data.labels.find((l) => l.id === dialog.id)?.name ?? "label"}` : "New label",
				actions: [save],
				children: [
					...error(dialog.error),
					{
						type: "form",
						id: "label",
						fields: [
							{ type: "text", id: "name", label: "Name", value: d.name },
							{ type: "select", id: "type", label: "Type", value: d.type, options: [{ value: "string", label: "Text" }, { value: "bool", label: "Yes/no" }] },
							{ type: "color", id: "color", label: "Color", value: (HUES as readonly string[]).includes(d.color) ? (d.color as (typeof HUES)[number]) : "blue" },
							...(d.type === "string"
								? ([
										{ type: "text", id: "values", label: "Values", value: d.values, placeholder: "High, Medium, Low", description: "Comma-separated lookup list." },
										{ type: "switch", id: "freeform", label: "Allow any text", value: d.freeform, description: "Values become suggestions." },
										{
											type: "select",
											id: "shades",
											label: "Intensity",
											value: d.shades || NONE,
											options: [
												{ value: NONE, label: "Same color for every value" },
												{ value: "strongest-first", label: "Strongest first, then lighter" },
												{ value: "lightest-first", label: "Lightest first, then stronger" },
											],
											description: "Gives each listed value its own shade of the color, in list order (High · Medium · Low).",
										},
									] satisfies Field[])
								: []),
						],
					},
				],
			};
		}
		case "updates":
			return updatesDialog(data, dialog);
		case "relationType":
			return {
				id: "relationType",
				title: dialog.id ? "Edit relation type" : "New relation type",
				actions: [save],
				children: [
					...error(dialog.error),
					{
						type: "form",
						id: "relationType",
						fields: [
							{ type: "text", id: "name", label: "Name", value: dialog.name, placeholder: "Blocks" },
							{ type: "text", id: "inverse", label: "From the other task", value: dialog.inverse, placeholder: "Blocked by", description: "Leave empty when it reads the same both ways." },
						],
					},
				],
			};
	}
}

/**
 * A task's updates: a composer (or the update being edited) above the timeline, newest first.
 * ⌘↵ adds or saves, E edits the focused update, ⌫ deletes it. The composer's field id changes
 * with every added update so it mounts fresh, empty and focused.
 */
function updatesDialog(data: Data, dialog: Extract<Dialog, { kind: "updates" }>): DialogNode {
	const task = data.tasks.find((t) => t.id === dialog.id);
	const list = task ? updatesOf(task) : [];
	const e = dialog.editing;
	const form: Node = e
		? {
				type: "form",
				id: "update-edit",
				fields: [
					{ type: "textarea", id: `edit-text-${e.update}`, label: "Update", value: e.text, markdown: true, rows: 5, autofocus: true },
					{ type: "datetime", id: "edit-added", label: "Added", value: e.added, placeholder: "Pick a date and time" },
					{ type: "datetime", id: "edit-updated", label: "Last updated", value: e.updated, placeholder: "Pick a date and time", description: "Moves to now by itself when you change the text, unless you set it here." },
				],
			}
		: {
				type: "form",
				id: "update-new",
				fields: [
					{
						type: "textarea",
						id: `text-${data.nextUpdateId}`,
						label: "Update",
						value: dialog.draft,
						markdown: true,
						rows: 4,
						autofocus: true,
						placeholder: "What changed? Markdown works: **bold**, - lists, [links](https://…)",
					},
				],
			};
	return {
		id: "updates",
		title: e ? `Edit update · ${taskName(data, dialog.id)}` : `Updates · ${taskName(data, dialog.id)}`,
		description: e ? undefined : "Newest first. ⌘↵ adds it. Tab to the list, then E edits and ⌫ deletes.",
		wide: true,
		resizable: true,
		actions: e
			? [
					{ id: "update-back", label: e.closeAfter ? "Discard" : "Back to updates", icon: "arrow-left" },
					{ id: "save", label: "Save update", primary: true },
				]
			: [{ id: "save", label: "Add update", primary: true, icon: "message-square-plus" }],
		children: [
			...error(dialog.error),
			form,
			{
				type: "timeline",
				id: "updates",
				entries: list.map((u) => ({ id: String(u.id), at: u.added, edited: u.updated, text: u.text })),
				actions: [
					{ id: "edit-update", label: "Edit", icon: "pencil", key: "e" },
					{ id: "delete-update", label: "Delete", icon: "trash-2", tone: "destructive", confirm: "Delete this update?" },
				],
				selected: e ? String(e.update) : undefined,
				empty: { title: "No updates yet", description: "Record progress as it happens. The newest update comes first.", icon: "history" },
			},
		],
	};
}

// ── quick view ──────────────────────────────────────────────────────────

/** The update's first line, for a list's second line. */
const latestUpdate = (t: Task) => {
	const u = updatesOf(t)[0];
	return u ? snippet(u.text) : undefined;
};

/**
 * The menu-bar quick view: a line to jot a new task into the Inbox (N), then the Inbox and what
 * you're working on, in the table's order. Every task carries one icon, its state's (the table's
 * section or group icon). Each task can be started, stopped, settled, snoozed or given an update
 * (U) without opening the window; ↵ opens it there. Unread tasks are bold; overdue ones get a red dot
 * and a red title.
 */
export function quickView(data: Data, now: number): Node {
	const waiting = inSection(data, "inbox");
	const working = inSection(data, "working");
	const later = {
		update: { id: "add-update", label: "Add update", icon: "message-square-plus", key: "u", input: { placeholder: "What changed? ↵ adds it" } },
		snooze: { id: "snooze", label: "Snooze…", icon: "alarm-clock", key: "z" },
		watch: { id: "watch", label: "Watch…", icon: "eye", key: "w" },
		settle: { id: "settle", label: "Settle", icon: "check", key: "s" },
	};
	const item = (t: Task) => {
		const since = workingSince(t);
		const labels = tags(data, t).map((tag) => tag.text).join(" · ");
		const note = latestUpdate(t);
		const subtitle = since ?[`Working on it · ${spent(now - since)}`, note ?? labels].filter(Boolean).join(" · ") : (t.unread && t.unreadReason) || note || labels || undefined;
		return {
			id: String(t.id),
			title: t.name,
			subtitle,
			icon: since ? STATE_ICONS.working : STATE_ICONS.inbox,
			dot: overdueDot(t, now),
			titleStyle: isOverdue(t, now) ? { color: "danger" as const } : undefined,
			...(t.due ? { metaAt: dueAt(t.due) } : {}),
			unread: t.unread || undefined,
			actions: since
				? [{ id: "done", label: "Done for now", icon: "inbox", key: "p" }, later.update, later.snooze, later.settle]
				: [{ id: "work", label: "Start working on it", icon: "play", key: "p" }, ...(t.watch ? [later.watch] : []), later.update, later.snooze, later.settle],
		};
	};
	return {
		type: "stack",
		gap: 2,
		children: [
			{ type: "composer", id: "quick-task", single: true, key: "n", placeholder: "New task… ↵ adds it to the Inbox", action: { id: "quick-task", label: "New task", icon: "plus" } },
			{
				type: "list",
				id: "focus",
				items: [...waiting, ...working].slice(0, 15).map(item),
				empty: { title: "Inbox zero", description: "Nothing waiting for you.", icon: STATE_ICONS.inbox },
			},
		],
	};
}
