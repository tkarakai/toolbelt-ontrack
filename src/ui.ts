// Builds OnTrack's surfaces from the data and the plugin's view state. Pure: given the same
// state and clock it returns the same trees, which the tests rely on.
import { asset, HUES, search, type Action, type Cell, type Dialog as DialogNode, type Field, type Filter, type Hue, type Node, type OptionItem, type Row, type Tag, type TagKey, type TagValue } from "@toolbelt/sdk";
import { cadenceLabel, defaultCheck, duration, inSection, nextOnSchedule, remindsAt, sectionOf, snoozeChoices, span, stallsAt, stallWarning, STATES, timeSpent, TRANSITIONS, untouched, WEEKLY, workingSince, type SectionId } from "./lifecycle";
import { DUE, DUE_BUCKETS, PROGRESSING_STATES, dropTarget, filterValues, forest, groupedLevels, groupTasks, placement, statusOf, type TreeNode, levelsOf, MAX_LEVELS, NO_VALUE, ONGOING, passes, STATUS, STATUS_LABELS, valueOf, YES, type FilterSetting, filterRow, type RowView, type GroupLook, type Looks, type StatusValue } from "./display";
import { BUILT_IN_RELATIONS, MAX_STALL_MINUTES, colorOf, dueAt, isBuiltInRelation, nextValueColor, parentOf, type SeenRelation, type SubtaskMode, relationsOf, shadeOf, toLocalInput, updatesOf, valueCounts, type Cadence, type Data, type Label, type LabelInput, type LabelType, type Task, type TaskInput, type Update, type Watch } from "./model";

export type Dialog =
	| { kind: "task"; id?: number; draft: TaskInput; start?: NewTaskStart; error?: string }
	| { kind: "relate"; from: number; type: string; to: string; error?: string }
	| { kind: "snooze"; id: number; until: string; error?: string }
	| WatchDialog
	| { kind: "label"; id?: number; draft: LabelDraft; error?: string }
	| { kind: "relationType"; id?: string; name: string; inverse: string; error?: string }
	| { kind: "updates"; id: number; draft: string; editing?: UpdateDraft; resume?: boolean; error?: string };

/**
 * What a new task starts with besides its fields: its workflow state and relations, as the
 * Related field holds them (key: a relation type's id, `~` before it for its inverse; value:
 * `#<id> <name>`).
 */
export type NewTaskStart = { state: Task["state"]; related: TagValue[] };
export const newTaskStart = (): NewTaskStart => ({ state: "inbox", related: [] });

/** A task as the Related field names it. */
export const relatedValue = (task: Pick<Task, "id" | "name">) => `#${task.id} ${task.name}`;
/** The task a Related value names, if any. */
export const relatedId = (value: string | undefined) => {
	const m = /^#(\d+)\b/.exec(value ?? "");
	return m ? Number(m[1]) : undefined;
};

/**
 * Relation types as the Related field's keys: each type, and its inverse when it reads
 * differently ("Child" for Parent). A task has one parent; the rest take several tasks.
 */
export function relatedKeys(data: Data, except?: number): TagKey[] {
	const values = tableOrder(data).filter((t) => t.id !== except).map(relatedValue);
	return data.relationTypes.flatMap((t): TagKey[] => [
		{ key: t.id, label: t.name, values, ...(t.id !== "parent" && { multiple: true }) },
		...(t.inverse === t.name ? [] : [{ key: `~${t.id}`, label: t.inverse, values, multiple: true }]),
	]);
}

/**
 * A task's relations as the Related field shows them, each with the relation it stands for:
 * one it holds under its type's key, one held by the other task under the inverse's (`~type`;
 * the type's own when it reads the same both ways).
 */
export function relatedEntries(data: Data, id: number): { value: TagValue; relation: SeenRelation }[] {
	const types = new Map(data.relationTypes.map((t) => [t.id, t]));
	return relationsOf(data, id).flatMap((r) => {
		const other = data.tasks.find((t) => t.id === r.task);
		if (!other) return [];
		const t = types.get(r.type);
		const key = r.inverse && t && t.inverse !== t.name ? `~${r.type}` : r.type;
		return [{ value: { key, value: relatedValue(other) }, relation: r }];
	});
}

/**
 * A label being edited. Each value has a key for the list editor: `v:` and its text when the
 * editor opened (kept in `from`, so a changed text is a rename), or `n:` and a number when added.
 */
export type LabelDraft = { name: string; type: LabelType; color: Hue; values: ValueDraft[]; freeform: boolean; valueColors: boolean; shades: string };
export type ValueDraft = { key: string; text: string; color: Hue; from?: string };

export function labelDraft(label?: Label): LabelDraft {
	if (!label) return { name: "", type: "string", color: "blue", values: [], freeform: false, valueColors: false, shades: "" };
	return {
		name: label.name,
		type: label.type,
		color: label.color,
		values: label.values.map((v) => ({ key: `v:${v.text}`, text: v.text, color: v.color, from: v.text })),
		freeform: label.freeform,
		valueColors: !!label.valueColors,
		shades: label.shades ?? "",
	};
}

/**
 * The values list editor's new state applied to the draft: known keys keep where they came
 * from; items without one are new and get a key, and a color when the editor gave none.
 */
export function applyValues(draft: LabelDraft, items: unknown, random?: () => number): void {
	if (!Array.isArray(items)) return;
	const known = new Map(draft.values.map((v) => [v.key, v]));
	let n = Math.max(0, ...draft.values.map((v) => (v.key.startsWith("n:") ? Number(v.key.slice(2)) : 0)));
	const values: ValueDraft[] = [];
	for (const item of items as OptionItem[]) {
		if (typeof item?.text !== "string") continue;
		const was = item.key === undefined ? undefined : known.get(item.key);
		const color = (HUES as readonly unknown[]).includes(item.color) ? item.color! : (was?.color ?? nextValueColor(values, random));
		values.push({ key: was?.key ?? `n:${++n}`, text: item.text, color, ...(was?.from !== undefined && { from: was.from }) });
	}
	draft.values = values;
}

export const labelInput = (d: LabelDraft): LabelInput => ({ ...d, values: d.values.map(({ text, color, from }) => ({ text, color, from })) });

/**
 * An update being edited in the Updates dialog: its text and times as the fields show them.
 * `closeAfter`: opened from the details drawer to edit just this one, so saving closes.
 */
export type UpdateDraft = { update: number; text: string; added: string; updated: string; closeAfter?: boolean };

export const updateDraft = (u: Update, closeAfter?: boolean): UpdateDraft => ({ update: u.id, text: u.text, added: toLocalInput(u.added), updated: toLocalInput(u.updated), ...(closeAfter && { closeAfter }) });

/**
 * What a screen shows beyond the data: the viewer's search, filter selections and arrangement
 * (Toolbelt keeps one view per viewer: every person's screen shares one, each agent has its own)
 * and, on the person's screens only, the open dialog.
 */
export type View = RowView & { search: string; dialog?: Dialog };

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

const NONE = "__none";

// ── shared helpers ──────────────────────────────────────────────────────

/** The task's labels as colored pills, in label order. Yes/no labels show their name. */
export function tags(data: Data, task: Task, labels: Label[] = data.labels): Tag[] {
	return labels.flatMap((label) => {
		const value = task.labels[label.id];
		if (value === undefined) return [];
		return [{ text: value === true ? label.name : String(value), color: colorOf(label, value), tooltip: value === true ? undefined : label.name, shade: shadeOf(label, value) }];
	});
}

/**
 * What a group's header already says about its tasks (each grouping filter's value along the
 * section id), so a row in it doesn't repeat it as a pill.
 */
const groupSays = (group: string | undefined) => (group ? dropTarget(group) : new Map<string, string>());

/** The task's state as a pill (Archived for an archived one), styled like its group header. */
const stateTag = (task: Task): Tag => {
	const status = statusOf(task);
	return { text: STATUS_LABELS[status], icon: status === "archived" ? "archive" : STATE_ICONS[task.state] };
};

/**
 * A row's pills: its state unless the group already says it, then its labels except those the
 * group already says (a task following its parent may differ from its group, and then says so).
 * `always`: the state shows regardless (a context row, which is elsewhere because of it).
 */
function rowTags(data: Data, task: Task, says: Map<string, string>, now: number, always = false): Tag[] {
	const state = always || says.get(STATUS) !== statusOf(task) ? [stateTag(task)] : [];
	const said = (label: Label) => says.get(`label:${label.id}`) === valueOf(data, `label:${label.id}`, task, now);
	return [...state, ...tags(data, task, data.labels.filter((l) => !said(l)))];
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

const taskName = (data: Data, id: number) => {
	const task = data.tasks.find((t) => t.id === id);
	return task ? `#${id} ${task.name}` : `#${id}`;
};

/** Overdue: past due and still open (not settled or archived). */
export const isOverdue = (task: Task, now: number) => !!task.due && task.state !== "settled" && !task.archived && dueAt(task.due) < now;

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

/** Whether the task matches the search (filters are `passes` in display.ts). */
function matches(data: Data, task: Task, s: ReturnType<typeof search>) {
	return s.test([`#${task.id}`, task.name, task.desc, task.watch?.on ?? "", ...task.updates.map((u) => u.text), ...tags(data, task).map((t) => t.text)]);
}

// ── actions ─────────────────────────────────────────────────────────────

/**
 * Every task action; each row offers the ones that fit its state (`actionsFor`). The state
 * machine: P starts work from the Inbox and brings a task back to the Inbox from anywhere else;
 * Z, W and S put it in Snoozed, Watching or Settled, or change it when it's there; ⇧P marks a
 * task you're working on stalled, and the next step (an update) brings it back. A archives,
 * E edits, R relates, U marks read.
 */
export function taskActions(now: number): Action[] {
	return [
		{ id: "work", label: "Start working on it", icon: "play", key: "p", inline: true, group: "flow" },
		{ id: "done", label: "Done for now", icon: "inbox", key: "p", inline: true, group: "flow" },
		{ id: "wake", label: "Back to Inbox", icon: "inbox", key: "p", inline: true, group: "flow" },
		{ id: "unwatch", label: "Back to Inbox", icon: "inbox", key: "p", inline: true, group: "flow" },
		{ id: "reopen", label: "Back to Inbox", icon: "inbox", key: "p", inline: true, group: "flow" },
		{ id: "unstall", label: "Back to Inbox", icon: "inbox", key: "p", inline: true, group: "flow" },
		// A stalled task goes back to Working on through an update: this lands in the drawer's box.
		{ id: "resume", label: "Write the next step", icon: "footprints", inline: true, group: "flow", focus: "update" },
		{ id: "stall", label: "Mark stalled", icon: "hourglass", key: "shift+p", group: "flow" },
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
		// In the drawer, R goes to its Related field; otherwise it opens a dialog.
{ id: "relate", label: "Relate to…", icon: "link", key: "r", group: "edit", focus: "related" },
		{ id: "mark-unread", label: "Mark unread", icon: "mail", key: "u", group: "edit" },
		{ id: "mark-read", label: "Mark read", icon: "mail-open", key: "u", group: "edit" },
		{ id: "indent", label: "Make it a subtask", icon: "indent-increase", key: "alt+right", group: "order" },
		{ id: "outdent", label: "Move out a level", icon: "indent-decrease", key: "alt+left", group: "order" },
		{ id: "up", label: "Move up", icon: "arrow-up", key: "alt+up", group: "order" },
		{ id: "down", label: "Move down", icon: "arrow-down", key: "alt+down", group: "order" },
		{ id: "archive", label: "Archive", icon: "archive", key: "a", group: "other" },
		{ id: "unarchive", label: "Unarchive", icon: "archive-restore", key: "a", group: "other" },
		{ id: "delete", label: "Delete", icon: "trash-2", tone: "destructive", confirm: "Delete this task and its relations?", group: "danger" },
	];
}

/** The action that moves a task into each state (into the Inbox, by where it comes from). */
const MOVE: Record<Exclude<Task["state"], "inbox">, string> = { working: "work", stalled: "stall", snoozed: "snooze", watching: "watch", settled: "settle" };
const BACK: Record<Exclude<Task["state"], "inbox">, string> = { working: "done", stalled: "unstall", snoozed: "wake", watching: "unwatch", settled: "reopen" };

/**
 * The action id that makes `task` move to `to` (which `TRANSITIONS` must allow). Back to Working
 * on from Stalled is writing the next step.
 */
export const actionFor = (task: Task, to: Task["state"]) =>
	to === "inbox" ? BACK[task.state as Exclude<Task["state"], "inbox">] : to === "working" && task.state === "stalled" ? "resume" : MOVE[to];

/**
 * The action ids a task offers: its moves from `TRANSITIONS` (P, ⇧P, Z, W, S), then the rest.
 * Without stalling (`stallOn` false), a task can't be marked stalled.
 */
export function actionsFor(task: Task, stallOn = true): string[] {
	if (task.archived) return ["unarchive", "edit", "add-update", "delete"];
	const section = sectionOf(task);
	const ids = TRANSITIONS[task.state].filter((to) => to !== "stalled" || stallOn).map((to) => actionFor(task, to));
	ids.push("edit", "add-update", "relate");
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
	stalled: asset("state-stalled"),
	snoozed: asset("state-snoozed"),
	watching: asset("state-watching"),
	settled: asset("state-settled"),
};

/**
 * How each group looks and takes drops. Status groups are the states' sections, as before:
 * Progressing holds Working on, Stalled, Snoozed and Watching (a drop on it starts work), Settled starts
 * collapsed, and Archived, the last, starts collapsed and dimmed. A drop into a label's group sets
 * that value (into its No group clears it); into Today or No date sets or clears the due date.
 */
export const LOOKS: Looks = {
	status: (value) =>
		(({
			inbox: { label: "Inbox", icon: STATE_ICONS.inbox, empty: "Inbox zero", dropLabel: "Move to Inbox", dropIcon: STATE_ICONS.inbox },
			progressing: { label: "Progressing", icon: STATE_ICONS.progressing, dropLabel: "Start working on it", dropIcon: STATE_ICONS.working },
			working: { label: "Working on", icon: STATE_ICONS.working, empty: "Nothing you're working on", dropLabel: "Start working on it", dropIcon: STATE_ICONS.working },
			stalled: { label: "Stalled", icon: STATE_ICONS.stalled, empty: "Nothing stalled", order: "fixed", dropLabel: "Mark stalled", dropIcon: STATE_ICONS.stalled },
			snoozed: { label: "Snoozed", icon: STATE_ICONS.snoozed, empty: "Nothing snoozed", order: "fixed", dropLabel: "Snooze…", dropIcon: STATE_ICONS.snoozed },
			watching: { label: "Watching", icon: STATE_ICONS.watching, empty: "Nothing to watch", order: "fixed", dropLabel: "Watch…", dropIcon: STATE_ICONS.watching },
			settled: { label: "Settled", icon: STATE_ICONS.settled, empty: "Nothing settled yet", collapsed: true, order: "fixed", dropLabel: "Settle", dropIcon: STATE_ICONS.settled },
			archived: { label: "Archived", icon: "archive", collapsed: true, muted: true, order: "fixed", dropLabel: "Archive", dropIcon: "archive" },
		}) satisfies Record<StatusValue | "progressing", GroupLook>)[value],
	due: (bucket) => {
		const label = DUE_BUCKETS.find((b) => b.id === bucket)!.label;
		const icon = { overdue: "alarm-clock", today: "calendar-check", next6: "calendar-days", later: "calendar", past: "history", none: "calendar-off" }[bucket];
		// Only Today and No date name one due date a drop can set.
		if (bucket === "today") return { label, icon, order: "fixed", dropLabel: "Due today", dropIcon: icon };
		if (bucket === "none") return { label, icon, order: "fixed", dropLabel: "Clear the due date", dropIcon: icon };
		return { label, icon, order: false };
	},
	label: (label, value) => {
		const none = value === NO_VALUE;
		const name = label.type === "bool" ? (none ? `Not ${label.name}` : label.name) : none ? `No ${label.name}` : value;
		// The value as its pill, the way rows show it, so it reads the same in the header.
const pill = none ? undefined : label.type === "bool" ? { color: label.color } : { color: colorOf(label, value), shade: shadeOf(label, value) };
return { label: name, ...(pill && { pill }), order: "fixed", dropLabel: none ? `Clear ${label.name}` : label.type === "bool" ? label.name : `${label.name}: ${value}`, dropIcon: label.type === "bool" ? "toggle-left" : "tag" };
	},
};

/** Every task in table order: each state's in its own order, then archived ones, newest first. */
const HOME_ORDER: SectionId[] = ["inbox", "working", "stalled", "snoozed", "watching", "settled"];
export const tableOrder = (data: Data) => [...HOME_ORDER.flatMap((id) => inSection(data, id)), ...data.tasks.filter((t) => t.archived).sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0) || b.id - a.id)];

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

/** "Untouched 6 days · stalled 3×": a stalled task's second line. */
export function stallLine(data: Data, task: Task, now: number) {
	const n = task.stalls ?? 0;
	return [`Untouched ${span(untouched(data, task, now))}`, n > 1 ? `stalled ${n}×` : undefined].filter(Boolean).join(" · ");
}

/**
 * The moment that matters for the task's section. A task you're working on, untouched long
 * enough to warn about, says for how long instead, in amber.
 */
function whenCell(data: Data, task: Task, now: number): Cell {
	if (stallWarning(data, task, now)) return { text: `Untouched ${span(untouched(data, task, now))}`, tone: "warning", icon: STATE_ICONS.stalled };
	if (task.state === "stalled" && task.stalledAt) return { text: "", at: task.stalledAt, icon: STATE_ICONS.stalled, tone: "warning" };
	if (task.state === "watching") return task.watch?.next !== undefined ? { text: "", at: task.watch.next, icon: STATE_ICONS.watching } : { text: "No reminder", icon: STATE_ICONS.watching, tone: "muted" };
	if (task.state === "snoozed" && task.snoozedUntil) return { text: "", at: task.snoozedUntil, icon: STATE_ICONS.snoozed };
	if (task.state === "settled" && task.settledAt) return { text: "", at: task.settledAt, icon: STATE_ICONS.settled };
	const since = workingSince(task);
	if (since) return { text: "", at: since, icon: STATE_ICONS.working };
	return { text: "", at: task.updated };
}

/**
 * A task's row in its group; an overdue one carries a red dot, one brought back by a check-in an
 * eye mark, and an archived one, wherever it shows, an archive mark and dimmed text.
 */
function taskRow(data: Data, task: Task, now: number, group?: string, tree?: RowTree, says: Map<string, string> = groupSays(group)): Row {
	const pills = rowTags(data, task, says, now);
	const marks = [
		// An archived task outside Archived says so; its Archived pill does when it has one.
		...(task.archived && says.get(STATUS) !== "archived" && !pills.some((p) => p.icon === "archive") ? [{ icon: "archive", tooltip: "Archived" }] : []),
		...(task.watch && task.state !== "watching" ? [{ icon: STATE_ICONS.watching, tooltip: task.watch.on ? `Watching: waiting on ${task.watch.on}` : "Watching" }] : []),
	];
	const sub =
		task.unread && task.unreadReason
			? task.unreadReason
			: task.state === "watching" && task.watch
				? watchLine(task.watch, now)
				: task.state === "stalled" && !task.archived
					? stallLine(data, task, now)
					: snippet(task.desc);
	return {
		id: String(task.id),
		group,
		unread: task.unread || undefined,
		// Overdue: a red dot beside the unread one, before the title, so titles line up.
		dot: overdueDot(task, now),
		// The first cell titles the details drawer.
		cells: {
			name: {
				text: task.name,
				// Its id, as a quiet pill in front of the title.
				prefix: { text: `#${task.id}` },
				tone: isOverdue(task, now) ? "danger" : task.archived ? "muted" : undefined,
				tags: [
					// Its state and labels, except what its group's header already says.
					...pills,
					...kidsTag(data, task),
				],
				sub,
				marks: marks.length ? marks : undefined,
			},
			due: dueCell(task, now),
			when: whenCell(data, task, now),
		},
		pane: taskPane(data, task, now),
		actions: [...actionsFor(task, data.stall.on), ...(tree?.under ? ["indent"] : []), ...(tree && parentOf(data, task.id) !== undefined ? ["outdent"] : [])],
		// Relations are removed from the Related field (its pills' ×).
		...(tree?.under && { targets: { indent: [{ id: String(tree.under.id), label: `Under ${taskName(data, tree.under.id)}`, icon: "indent-increase" }] } }),
		...(tree?.children.length && { children: tree.children, open: true }),
	};
}

/** A parent's `settled/total` pill. */
function kidsTag(data: Data, task: Task): Tag[] {
	const kids = data.tasks.filter((t) => parentOf(data, t.id) === task.id);
	if (!kids.length) return [];
	const settled = kids.filter((t) => t.state === "settled" || t.archived).length;
	return [{ text: `${settled}/${kids.length}`, icon: "list-tree", tooltip: `${settled} of ${kids.length} subtask${kids.length === 1 ? "" : "s"} settled` }];
}

/** Where a row sits in its group's tree: the rows under it and the task above it (⌥→ goes under that one). */
type RowTree = { children: Row[]; under?: Task };

/**
 * A group's rows as a tree (subtasks on): each task under its parent, a parent that's elsewhere
 * shown dimmed for context (`Row.context`, its id `c<task>@<group>`) with its state pill. Nested
 * rows say what differs from their group (`key`): following its parent, a subtask's own state.
 */
function treeRows(data: Data, nodes: TreeNode[], group: string | undefined, now: number, key = group): Row[] {
	const says = groupSays(key);
	return nodes.map((n, i) => {
		const children = treeRows(data, n.children, undefined, now, key);
		const under = i > 0 ? nodes[i - 1]!.task : undefined;
		if (!n.context) return taskRow(data, n.task, now, group, { children, under }, says);
		// A parent shown here for context acts as the task itself (`contextSelect`): the same
		// cells, actions and drawer, its events naming the task. Its state always shows: it's
		// why the parent isn't in this group.
		const real = taskRow(data, n.task, now, group, { children }, says);
		return {
			...real,
			id: `c${n.task.id}@${group ?? ""}`,
			context: String(n.task.id),
			cells: { ...real.cells, name: { ...(real.cells.name as Exclude<Cell, string | number | null>), tags: [...rowTags(data, n.task, says, now, true), ...kidsTag(data, n.task)] } },
			children,
			open: true,
		};
	});
}

/** The Subtasks control's choices. */
const SUBTASK_OPTIONS: { value: SubtaskMode; label: string; description?: string; section?: string }[] = [
	{ value: "off", label: "Off", description: "Every task on a row of its own" },
	{ value: "own", label: "Stay in their own group", description: "A parent elsewhere shows dimmed above them", section: "Subtask hierarchy" },
	{ value: "parent", label: "Follow their parent", description: "The whole family sits with its top parent", section: "Subtask hierarchy" },
];

/** Where a new task can start: anywhere (Snoozed and Watching ask for their details on save). */
const NEW_STATES: { value: Task["state"]; label: string }[] = [
	{ value: "inbox", label: "Inbox" },
	{ value: "working", label: "Working on" },
	{ value: "snoozed", label: "Snooze…" },
	{ value: "watching", label: "Watching…" },
	{ value: "settled", label: "Settled" },
];

/**
 * The status picker's choices: where the task is now (with its moment), and where it can go.
 * Stalled is offered while stalling is on; from Stalled, Working on asks for the next step.
 */
function statusOptions(data: Data, task: Task, now: number) {
	const since = workingSince(task);
	const at = (ms: number) => stamp(ms, now);
	// Only the states `TRANSITIONS` allows from here, in list order, and the current one.
	const reachable = (value: string) => value === task.state || (TRANSITIONS[task.state].includes(value as Task["state"]) && (value !== "stalled" || data.stall.on));
	return ([
		{ value: "inbox", label: "Inbox" },
		{ value: "working", label: task.state === "working" && since ? `Working on · since ${at(since)}` : task.state === "stalled" ? "Working on · write the next step…" : "Working on" },
		{ value: "stalled", label: task.state === "stalled" && task.stalledAt ? `Stalled since ${at(task.stalledAt)}` : "Stalled" },
		{ value: "snoozed", label: task.state === "snoozed" && task.snoozedUntil ? `Snoozed until ${at(task.snoozedUntil)}` : "Snooze…" },
		{
			value: "watching",
			label: task.state === "watching" ? (task.watch?.next !== undefined ? `Watching · next check-in ${at(task.watch.next)}` : "Watching · no reminders") : "Watching…",
		},
		{ value: "settled", label: task.state === "settled" && task.settledAt ? `Settled ${at(task.settledAt)}` : "Settled" },
	] satisfies { value: (typeof STATES)[number]; label: string }[]).filter((o) => reachable(o.value));
}

/**
 * Where a task stands on stalling, as a section of the drawer (drawn like Parent or Updates): a
 * stalled task's says how long it's been untouched (in amber), since when it's stalled, how many
 * times and the next reminder, then what gets it moving; a task you're working on that's turned
 * amber says when it will stall. The other ways out are the drawer's buttons.
 */
function stallCard(data: Data, task: Task, now: number): Node | undefined {
	if (task.archived) return undefined;
	const at = (ms: number) => stamp(ms, now);
	const idle = { label: "Untouched", value: span(untouched(data, task, now)), tone: "warning" as const };
	const hint = (text: string): Node => ({ type: "text", text, tone: "muted" });
	if (task.state === "stalled") {
		const n = task.stalls ?? 1;
		const reminder = remindsAt(data, task);
		return {
			type: "card",
			id: "stall",
			title: "Stalled",
			children: [
				{
					type: "details",
					items: [
						idle,
						...(task.stalledAt ? [{ label: "Since", value: at(task.stalledAt) }] : []),
						{ label: "Times stalled", value: n === 1 ? "First time" : `${n}` },
						{ label: "Next reminder", value: reminder ? at(reminder) : "Off" },
					],
				},
				hint("Write the next step (↵) to get back to it."),
			],
		};
	}
	const stalls = stallsAt(data, task);
	if (stalls === undefined || !stallWarning(data, task, now)) return undefined;
	return {
		type: "card",
		id: "stall",
		title: "Stalls soon",
		children: [{ type: "details", items: [idle, { label: "Stalls", value: at(stalls) }] }, hint("Add an update or edit it to keep it in Working on.")],
	};
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

/** Following a relation: a Related pill, or an item of the drawer's relation lists, goes to that task. */
const GO_TO_RELATED: Action = { id: "open-related", label: "Go to this task", icon: "arrow-up-right" };
const GO_TO_TASK: Action = { id: "open-task", label: "Go to this task", icon: "arrow-up-right" };

/** The list item id of a related task (`rel:<id>`), apart from the table's row ids. */
export const relatedItemId = (id: number) => `rel:${id}`;

/**
 * The built-in relations in the drawer, when the task has any: its Parent, Children (with how
 * many are settled), Blocked by and Blocks, titled with the types' current names. Each task
 * shows as in the table: state, id, name, labels, due date, unread and overdue dots.
 */
function familyCards(data: Data, task: Task, now: number): Node[] {
	const type = (id: string) => data.relationTypes.find((t) => t.id === id);
	const parentType = type("parent");
	const blocksType = type("blocks");
	const byOrder = (tasks: Task[]) => tableOrder(data).filter((t) => tasks.includes(t));
	const parent = parentOf(data, task.id);
	const children = data.tasks.filter((t) => parentOf(data, t.id) === task.id);
	const blocks = data.tasks.filter((t) => task.relations.some((r) => r.type === "blocks" && r.task === t.id));
	const blockedBy = data.tasks.filter((t) => t.relations.some((r) => r.type === "blocks" && r.task === task.id));
	const settled = children.filter((t) => t.state === "settled" || t.archived).length;
	const cards: [string, string, Task[]][] = [
		["parent", parentType?.name ?? "Parent", data.tasks.filter((t) => t.id === parent)],
		["children", `${parentType?.inverse === "Child" ? "Children" : (parentType?.inverse ?? "Children")} · ${settled}/${children.length} settled`, byOrder(children)],
		["blocked-by", blocksType?.inverse ?? "Blocked by", byOrder(blockedBy)],
		["blocks", blocksType?.name ?? "Blocks", byOrder(blocks)],
	];
	return cards
		.filter(([, , tasks]) => tasks.length)
		.map(([id, title, tasks]) => ({
			type: "card" as const,
			id: `rel-${id}`,
			title: id === "children" ? title : `${title} · ${tasks.length}`,
			// No icons (the state pill says it); `inset` keeps their space, indenting the rows.
			children: [{ type: "list" as const, id: `rel-${id}`, open: GO_TO_TASK, inset: true, items: tasks.map((t) => relatedItem(data, t, now)) }],
		}));
}

/** A related task as a list item, with what its table row shows. */
function relatedItem(data: Data, t: Task, now: number) {
	const done = t.state === "settled" || t.archived;
	return {
		id: relatedItemId(t.id),
		title: t.name,
		prefix: { text: `#${t.id}` },
		tags: [stateTag(t), ...tags(data, t)],
		dot: overdueDot(t, now),
		unread: t.unread || undefined,
		...(isOverdue(t, now) ? { titleStyle: { color: "danger" as const } } : done ? { titleStyle: { color: "muted" as const } } : {}),
		...(t.due ? { meta: friendlyDue(t.due, now) } : {}),
	};
}

/** One quiet line of facts under the properties, when there are any: archived, time spent. */
function factsLine(task: Task, now: number) {
	const worked = timeSpent(task, now);
	return (
		[task.archived ? "Archived" : undefined, worked ? `${spent(worked)} worked in ${task.sessions.length} session${task.sessions.length === 1 ? "" : "s"}` : undefined]
			.filter(Boolean)
			.join(" · ") || undefined
	);
}

/** When the task was made and last changed. */
const madeLine = (task: Task, now: number) => [`Created ${stamp(task.created, now)}`, task.updated - task.created > 60_000 ? `changed ${stamp(task.updated, now)}` : undefined].filter(Boolean).join(" · ");

/**
 * The task's details drawer, edited in place: its name, status, due date, labels and description
 * as a property sheet, then relations, then updates with a composer on top (↵ on the task lands
 * there). Each field saves on its own; nothing is repeated from elsewhere in the drawer.
 */
export function taskPane(data: Data, task: Task, now: number): Node[] {
	const updates = updatesOf(task);
	return [
		// A stalled task's card says it all; others say what's new.
		...(task.unread && task.unreadReason && task.state !== "stalled" ? [{ type: "text" as const, text: `New · ${task.unreadReason}`, tone: "info" as const }] : []),
		{
			type: "form",
			id: "task",
			appearance: "inline",
			fields: [
				{ type: "text", id: "name", label: "Name", value: task.name, heading: true, note: `#${task.id}`, placeholder: "What needs doing" },
				...(task.archived ? [] : [{ type: "select" as const, id: "state", label: "Workflow", value: task.state, options: statusOptions(data, task, now) }]),
				{ type: "datetime", id: "due", label: isOverdue(task, now) ? "Overdue" : "Due", value: task.due ?? "", placeholder: "No due date" },
				{ type: "tags", id: "labels", label: "Labels", value: toTagValues(task.labels), keys: tagKeys(data) },
				// Relations are added like labels: + Add, the relation, then the task.
				...(data.relationTypes.length ? [{ type: "tags" as const, id: "related", label: "Related", value: relatedEntries(data, task.id).map((e) => e.value), keys: relatedKeys(data, task.id), open: GO_TO_RELATED }] : []),
				{ type: "textarea", id: "desc", label: "", value: task.desc, markdown: true, rows: 6, placeholder: "Add a description…" },
			],
		},
		...(task.watch && task.state !== "settled" ? [{ type: "text" as const, text: watchFacts(task, now), tone: "muted" as const }] : []),
		// Stalled, or about to: a section of its own, before the relations.
		...(stallCard(data, task, now) ? [stallCard(data, task, now)!] : []),
		// The built-in relations, each a list of its tasks, as rich as their rows; a click goes there.
...familyCards(data, task, now),
...(factsLine(task, now) ? [{ type: "text" as const, text: factsLine(task, now)!, tone: "muted" as const }] : []),
		// When it was made and changed, just above its history.
		{ type: "text", text: madeLine(task, now), tone: "muted" },
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

/** "Grouping goes 10 levels deep at most": why a filter can't start grouping now. */
const DEPTH_LIMIT = `Grouping goes ${MAX_LEVELS} levels deep at most`;

/** One filter of the toolbar row, with counts of the tasks the other filters and the search leave. */
function filterNode(data: Data, f: FilterSetting, pool: Task[], now: number): Filter {
	const counts = new Map<string, number>();
	for (const t of pool) {
		if (!passes(data, t, now, f.id)) continue;
		const v = valueOf(data, f.id, t, now);
		counts.set(v, (counts.get(v) ?? 0) + 1);
	}
	const values = filterValues(data, f.id);
	const grouping = { group: f.group, ...(!f.group && groupedLevels(data.filters) + levelsOf(f.id) > MAX_LEVELS && { groupDisabled: DEPTH_LIMIT }) };
	if (f.id === STATUS)
		// Its menu follows the list: the Inbox, Progressing's states under their heading, then Settled and Archived.
		return { id: f.id, label: "Workflow", icon: "list-checks", options: values.map((v) => ({ value: v, label: STATUS_LABELS[v as StatusValue], count: counts.get(v) ?? 0, ...(PROGRESSING_STATES.includes(v as StatusValue) && { section: "Progressing" }) })), selected: f.selected, default: { values: [...ONGOING], label: "Ongoing" }, ...grouping };
	if (f.id === DUE)
		return { id: f.id, label: "Due", icon: "calendar", options: values.map((v) => ({ value: v, label: DUE_BUCKETS.find((b) => b.id === v)!.label, count: counts.get(v) ?? 0 })), selected: f.selected, ...grouping };
	const label = data.labels.find((l) => `label:${l.id}` === f.id)!;
	return {
		id: f.id,
		label: label.name,
		icon: label.type === "bool" ? "toggle-left" : "tag",
		options: values.map((value) => ({
			value,
			label: value === NO_VALUE ? (label.type === "bool" ? "No" : `No ${label.name}`) : value === YES && label.type === "bool" ? "Yes" : value,
			...(value !== NO_VALUE && { dot: label.type === "bool" ? label.color : colorOf(label, value) }),
			count: counts.get(value) ?? 0,
		})),
		selected: f.selected,
		...grouping,
	};
}

export function tasksScreen(stored: Data, view: View, now: number): Node {
	// The viewer's filter row stands in for the stored one.
	const data: Data = { ...stored, filters: filterRow(stored, view) };
	const s = search(view.search);
	// The search narrows everything, the filters' counts included.
	const pool = tableOrder(data).filter((t) => matches(data, t, s));
	const shown = pool.filter((t) => passes(data, t, now));
	const mode = data.subtasks;
	const { sections, groupOf } = groupTasks(data, shown, now, LOOKS, placement(data, shown, mode));
	let rows: Row[];
	if (mode === "off") rows = shown.map((t) => taskRow(data, t, now, groupOf.get(t.id)));
	else {
		// Each group's tasks (in table order) as a tree.
		const groups = new Map<string, Task[]>();
		for (const t of shown) {
			const key = groupOf.get(t.id) ?? "";
			groups.set(key, [...(groups.get(key) ?? []), t]);
		}
		rows = [...groups].flatMap(([key, tasks]) => treeRows(data, forest(data, tasks), key || undefined, now));
	}
	const filters = data.filters.map((f) => filterNode(data, f, pool, now));
	return {
		type: "page",
		search: { placeholder: "Search tasks" },
		highlight: s.highlight(),
		filters,
		controls: [{ type: "choice", id: "subtasks", label: "Subtasks", icon: "list-tree", value: mode, options: SUBTASK_OPTIONS }],
		actions: [{ id: "new-task", label: "New task", icon: "plus", primary: true, key: "n" }],
		children: [
			{
				type: "table",
				id: "tasks",
				columns: [
					// The first column titles the details drawer, so it's the name.
					{ key: "name", title: "Task", grow: true },
					{ key: "due", title: "Due", width: 176, priority: 2 },
					{ key: "when", title: "When", width: 120, priority: 3 },
				],
				appearance: "document",
				...(sections.length && { sections, reorder: true }),
				...(mode !== "off" && { reorder: true, reorderOnto: "Make it a subtask", contextSelect: true }),
// The drawer ends with the row's actions as buttons; its fields edit in place.
paneButtons: true,
				selectEvents: true,
				// ↵ on a task writes an update in its drawer.
				enter: "add-update",
				rows,
				actions: taskActions(now),
				empty: data.tasks.length
						? { title: "No matching tasks", description: "Change the search or filters.", icon: "search-x" }
						: { title: "No tasks yet", description: "Create one with New task (N).", icon: "list-checks" },
			},
		],
		dialog: view.dialog &&["task", "relate", "snooze", "watch", "updates"].includes(view.dialog.kind) ? dialogNode(data, view.dialog, now) : undefined,
	};
}

// ── settings screen ─────────────────────────────────────────────────────

const DAY = 1440;
/** Quick picks for the stalling durations, in minutes; each field offers those that fit it. */
const STALL_PRESETS = [30, 60, 4 * 60, DAY, 2 * DAY, 3 * DAY, 7 * DAY];

/**
 * Settings' Stalling section, one form (Toolbelt draws it as its own card): whether tasks stall,
 * after how long, when rows turn amber (always sooner, so its longest choice is just under the
 * stall), how often a stalled task reminds you, and whether weekends count. Durations are edited
 * as days, hours and minutes; each change saves on its own (`setStall`).
 */
export function stallForm(data: Data): Node {
	const s = data.stall;
	const fits = (max: number) => STALL_PRESETS.filter((m) => m <= max).map((value) => ({ value }));
	const fields: Field[] = [
		{ type: "switch", id: "on", label: "Stall tasks left untouched", value: s.on, description: "A task in Working on with no update or edit for a while moves to Stalled, unread. Writing its next step brings it back." },
		...(s.on
			? ([
					{ type: "duration", id: "after", label: "Stall after", value: s.after, min: 2, max: MAX_STALL_MINUTES, presets: fits(MAX_STALL_MINUTES) },
					{
						type: "duration",
						id: "warnAfter",
						label: "Turn amber after",
						value: s.warnAfter,
						min: 1,
						max: s.after - 1,
						presets: fits(s.after - 1),
						description: "Its row says how long it's been untouched, in amber, before it stalls.",
					},
					{
						type: "duration",
						id: "remindEvery",
						label: "Remind me every",
						value: s.remindEvery,
						min: 1,
						max: MAX_STALL_MINUTES,
						none: "Never",
						presets: [{ value: null }, ...fits(MAX_STALL_MINUTES)],
						description: "While a task stays stalled, it's marked unread again.",
					},
					{ type: "switch", id: "weekends", label: "Count weekends", value: s.weekends, description: "Off: time on Saturdays and Sundays doesn't count." },
				] satisfies Field[])
			: []),
	];
	return { type: "form", id: "stall", title: "Stalling", description: "Tasks you chose to work on but stopped touching.", fields };
}

/** Labels and relation types, each table with its own New button above it; then Stalling. */
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
								name: { text: label.name, dot: label.valueColors ? "rainbow" : label.color },
								type: label.type === "bool" ? "Yes/no" : label.freeform ? "Free text" : "Lookup",
								values: label.values.length
									? { text: "", tags: label.values.map((v) => ({ text: v.text, color: colorOf(label, v.text), shade: shadeOf(label, v.text) })), sub: label.freeform ? "and any text" : undefined }
									: { text: label.type === "bool" ? "—" : label.freeform ? "any text" : "none yet", tone: "muted" },
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
							// Built-in types drive behavior: renamed, never deleted.
							...(isBuiltInRelation(t.id) && { actions: ["edit-relation-type"] }),
							cells: {
								name: { text: t.name, sub: BUILT_IN_RELATIONS.find((b) => b.id === t.id)?.role ?? t.id, ...(isBuiltInRelation(t.id) && { marks: [{ icon: "lock", tooltip: "Built in: it can be renamed, not deleted" }] }) },
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
			stallForm(data),
		],
		dialog: view.dialog && ["label", "relationType"].includes(view.dialog.kind) ? dialogNode(data, view.dialog, now) : undefined,
	};
}

// ── dialogs ─────────────────────────────────────────────────────────────

/**
 * Labels as the pill editor's keys: yes/no labels are flags, text labels pick from their values
 * (free-text ones take any text too), drawn in their shades or their own colors (those keys
 * have no color of their own, so the picker shows them a rainbow dot).
 */
export function tagKeys(data: Data): TagKey[] {
	return data.labels.map((l) => {
		if (l.type === "bool") return { key: String(l.id), label: l.name, color: l.color, flag: true };
		const shades = Object.fromEntries(l.values.flatMap((v) => { const shade = shadeOf(l, v.text); return shade === undefined ? [] : [[v.text, shade]]; }));
		return {
			key: String(l.id),
			label: l.name,
			...(!l.valueColors && { color: l.color }),
			values: l.values.map((v) => v.text),
			freeform: l.freeform,
			...(Object.keys(shades).length && { shades }),
			...(l.valueColors && { colors: Object.fromEntries(l.values.map((v) => [v.text, v.color])) }),
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
			// A new task can start anywhere in the workflow and with relations, as the drawer sets them.
			const start = dialog.id ? undefined : (dialog.start ?? newTaskStart());
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
							...(start
								? [{ type: "select" as const, id: "state", label: "Workflow", value: start.state, options: NEW_STATES, description: start.state === "snoozed" || start.state === "watching" ? "Saving asks when to bring it back." : undefined }]
								: []),
							{ type: "datetime", id: "due", label: "Due", value: d.due, placeholder: "No due date", description: "Optional. Without a time, it's due at the end of the day." },
							{ type: "tags", id: "labels", label: "Labels", value: toTagValues(d.labels), keys: tagKeys(data) },
							...(start && data.relationTypes.length ? [{ type: "tags" as const, id: "related", label: "Related", value: start.related, keys: relatedKeys(data) }] : []),
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
		case "label":
			return labelDialog(data, dialog);
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
	// On a stalled task, the next update is its next step, and saving it brings the task back.
	const resume = !e && !!dialog.resume;
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
						placeholder: resume ? "Next: …" : "What changed? Markdown works: **bold**, - lists, [links](https://…)",
					},
				],
			};
	return {
		id: "updates",
		title: e ? `Edit update · ${taskName(data, dialog.id)}` : resume ? `Next step · ${taskName(data, dialog.id)}` : `Updates · ${taskName(data, dialog.id)}`,
		description: e
			? undefined
			: resume
				? "What's the smallest next step? Saving it moves the task back to Working on."
				: "Newest first. ⌘↵ adds it. Tab to the list, then E edits and ⌫ deletes.",
		wide: true,
		resizable: true,
		actions: e
			? [
					{ id: "update-back", label: e.closeAfter ? "Discard" : "Back to updates", icon: "arrow-left" },
					{ id: "save", label: "Save update", primary: true },
				]
			: [{ id: "save", label: resume ? "Back to work" : "Add update", primary: true, icon: resume ? "play" : "message-square-plus" }],
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
 * The menu-bar quick view: a line to jot a new task into the Inbox (N), then the Inbox, what
 * you're working on and what stalled, in the table's order. A stalled task's update (U) is its
 * next step, which brings it back to Working on. Every task carries one icon, its state's (the table's
 * section or group icon). Each task can be started, stopped, settled, snoozed or given an update
 * (U) without opening the window; ↵ opens it there. Unread tasks are bold; overdue ones get a red dot
 * and a red title.
 */
export function quickView(data: Data, now: number): Node {
	const waiting = inSection(data, "inbox");
	const working = inSection(data, "working");
	const stalled = inSection(data, "stalled");
	const later = {
		update: { id: "add-update", label: "Add update", icon: "message-square-plus", key: "u", input: { placeholder: "What changed? ↵ adds it" } },
		snooze: { id: "snooze", label: "Snooze…", icon: "alarm-clock", key: "z" },
		watch: { id: "watch", label: "Watch…", icon: "eye", key: "w" },
		settle: { id: "settle", label: "Settle", icon: "check", key: "s" },
	};
	const item = (t: Task) => {
		if (t.state === "stalled")
			return {
				id: String(t.id),
				title: t.name,
				subtitle: (t.unread && t.unreadReason) || `Stalled · ${stallLine(data, t, now).toLowerCase()}`,
				icon: STATE_ICONS.stalled,
				dot: overdueDot(t, now),
				titleStyle: isOverdue(t, now) ? { color: "danger" as const } : undefined,
				...(t.due ? { metaAt: dueAt(t.due) } : {}),
				unread: t.unread || undefined,
				actions: [
					{ ...later.update, label: "Write the next step", input: { placeholder: "Next step… ↵ moves it back to Working on" } },
					{ id: "unstall", label: "Back to Inbox", icon: "inbox", key: "p" },
					later.snooze,
					later.settle,
				],
			};
		const since = workingSince(t);
		const labels = tags(data, t).map((tag) => tag.text).join(" · ");
		const note = latestUpdate(t);
		const subtitle = since ?[`Working on · ${spent(now - since)}`, note ?? labels].filter(Boolean).join(" · ") : (t.unread && t.unreadReason) || note || labels || undefined;
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
				items: [...waiting, ...working, ...stalled].slice(0, 15).map(item),
				empty: { title: "Inbox zero", description: "Nothing waiting for you.", icon: STATE_ICONS.inbox },
			},
		],
	};
}

/**
 * The label editor, in three parts: what it is (name, type), its values (a list to add to,
 * rename, reorder and recolor; whether tasks can add more) and how it's colored (one color,
 * optionally shaded, or each value its own). Settings that don't apply are left out.
 */
function labelDialog(data: Data, dialog: Extract<Dialog, { kind: "label" }>): DialogNode {
	const d = dialog.draft;
	const label = dialog.id ? data.labels.find((l) => l.id === dialog.id) : undefined;
	const counts = label ? valueCounts(data, label) : new Map<string, number>();
	const text = d.type === "string";
	const color: Field = { type: "color", id: "color", label: text ? "Label color" : "Color", value: d.color };
	return {
		id: "label",
		title: label ? `Edit ${label.name}` : "New label",
		actions: [save],
		children: [
			...error(dialog.error),
			{
				type: "form",
				id: "label",
				fields: [
					{ type: "text", id: "name", label: "Name", value: d.name, placeholder: "Priority" },
					{ type: "select", id: "type", label: "Type", value: d.type, options: [{ value: "string", label: "Text" }, { value: "bool", label: "Yes/no" }] },
				],
			},
			...(text
				? ([
						{
							type: "form",
							id: "label-values",
							fields: [
								{
									type: "options",
									id: "values",
									label: "Values",
									value: d.values.map((v) => ({ key: v.key, text: v.text, ...(d.valueColors && { color: v.color }), ...(label && { count: counts.get(v.from ?? "") ?? 0 }) })),
									colors: d.valueColors,
									reorder: true,
									placeholder: "Add value",
									description: label ? "Renaming a value renames it on its tasks; removing one takes it off them." : undefined,
								},
								{ type: "switch", id: "freeform", label: "Allow free-form values", value: d.freeform, description: "Tasks can use new values, which join the list." },
							],
						},
						{
							type: "form",
							id: "label-color",
							fields: [
								{
									type: "select",
									id: "valueColors",
									label: "Colors",
									value: d.valueColors ? "each" : "one",
									options: [
										{ value: "one", label: "One color for every value" },
										{ value: "each", label: "Each value its own color" },
									],
									description: d.valueColors ? "Change a value's color with its dot. New values get the color the label uses least." : undefined,
								},
								...(d.valueColors ? [] : [color]),
								...(!d.valueColors && d.values.length > 1
									? ([
											{
												type: "select",
												id: "shades",
												label: "Intensity",
												value: d.shades || NONE,
												options: [
													{ value: NONE, label: "The same for every value" },
													{ value: "strongest-first", label: "Strongest first, then lighter" },
													{ value: "lightest-first", label: "Lightest first, then stronger" },
												],
												description: "Shades the values in list order (High · Medium · Low).",
											},
										] satisfies Field[])
									: []),
							],
						},
					] satisfies Node[])
				: ([{ type: "form", id: "label-color", fields: [color] }] satisfies Node[])),
		],
	};
}
