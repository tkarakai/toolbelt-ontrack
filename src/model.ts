// OnTrack's data model and the pure operations on it. Nothing here touches the disk or the SDK,
// so every rule is testable on plain objects.
import { HUES, leastUsedHue, type Hue } from "@toolbelt/sdk";
import { defaultFilters, normalizeFilters, type FilterSetting } from "./display";

export const SCHEMA = 6;

export type LabelType = "string" | "bool";

/**
 * A label is a named, colored attribute a task can carry with one value.
 * - `bool` labels are either present (true) or absent; they have no values.
 * - `string` labels pick from `values`, the one list of every value the label has: every value
 *   a task carries is in it. With `freeform`, tasks can add to it by typing a new value.
 */
export type Label = {
	id: number;
	name: string;
	type: LabelType;
	/** The label's color: its name's dot, and every value's unless `valueColors`. */
	color: Hue;
	values: LabelValue[];
	freeform: boolean;
	/** Each value is drawn in its own color instead of the label's. */
	valueColors?: true;
	/**
	 * With one color (no `valueColors`), values get their own intensity of it, in list order: the
	 * first strongest (High · Medium · Low) or the first lightest. Absent: all the same.
	 */
	shades?: LabelShades;
};

/**
 * A value of a text label. Its color is chosen when the value is added (one the label uses least)
 * and stays with it through renames and moves until the person changes it; it shows when the
 * label has `valueColors`.
 */
export type LabelValue = { text: string; color: Hue };

export type LabelShades = "strongest-first" | "lightest-first";
export const LABEL_SHADES: readonly LabelShades[] = ["strongest-first", "lightest-first"];

/**
 * How one task relates to another. Stored once on the task that holds it, read from both sides:
 * `{ task: 7, type: "parent" }` on task 3 reads "Parent: #7" on 3 and "Child: #3" on 7.
 */
export type RelationType = { id: string; name: string; inverse: string };

export type Relation = { task: number; type: string };

/**
 * Where a task is in its life, as in T3 Code's thread list: waiting in the Inbox, being worked on,
 * snoozed until a time, watched (out of your hands for now, checked on from time to time) or
 * settled (done). Archiving is a separate flag on top.
 */
export type TaskState = "inbox" | "working" | "snoozed" | "watching" | "settled";

export type CadenceUnit = "day" | "week" | "month";
export const CADENCE_UNITS: readonly CadenceUnit[] = ["day", "week", "month"];
/** How often a watched task asks to be checked on: every `n` days, weeks or months. */
export type Cadence = { n: number; unit: CadenceUnit };

/**
 * A task you keep an eye on: someone else has the ball, or it just needs checking now and then.
 * It stays with the task while it's watched and after a check-in brings it back to the Inbox,
 * so watching it again (W) is that check; starting work, settling or P in Watching ends it.
 */
export type Watch = {
	/** Who or what it's waiting on ("Cobra team"). */
	on?: string;
	/** Epoch ms watching started. */
	since: number;
	/** Repeat; absent means one check-in (or none, without `next`). */
	every?: Cadence;
	/** The first check-in of the current schedule; repeats count from it, keeping its day and time. */
	anchor?: number;
	/** The next check-in (while watching), or the one that brought it back. Absent: no reminders. */
	next?: number;
	/** Epoch ms of the last check (watching it again after a check-in). */
	checked?: number;
	/** How many times it was checked on. */
	checks: number;
};

/** A stretch of work on a task, by whoever worked on it ("me" now; an agent later). */
export type Session = { start: number; end?: number; by: string };

/**
 * A progress note on a task: what happened, in Markdown. `added` and `updated` are epoch ms;
 * both can be corrected by hand, and `updated` moves on by itself when the text changes.
 */
export type Update = { id: number; added: number; updated: number; text: string };

export type Task = {
	id: number;
	name: string;
	/** Epoch ms. */
	created: number;
	/** Epoch ms; changes on every edit of the task's own fields, labels or relations. */
	updated: number;
	/** Local wall-clock due date, `YYYY-MM-DD` or `YYYY-MM-DDTHH:MM`. */
	due?: string;
	/** Markdown. */
	desc: string;
	/** Label id → value (`true` for bool labels). */
	labels: Record<string, string | boolean>;
	relations: Relation[];
	state: TaskState;
	/** Out of the way: shown only when the Status filter includes Archived, in its own group. */
	archived: boolean;
	/** Epoch ms it was archived (while `archived`); the Archived group shows newest first. */
	archivedAt?: number;
	/** Something happened since the person last opened it; `unreadReason` says what. */
	unread: boolean;
	unreadReason?: string;
	/** Epoch ms the snooze ends (state `snoozed`). */
	snoozedUntil?: number;
	/** Watching it: who it's waiting on and when to check in. */
	watch?: Watch;
	/** Epoch ms it was settled (state `settled`). */
	settledAt?: number;
	/** The `due` value whose arrival was already announced, so it's announced once. */
	dueAnnounced?: string;
	sessions: Session[];
	/** Progress notes, in the order they were written (shown newest first). */
	updates: Update[];
};

/** The person's order of the sections they arrange; ids not listed go last. */
export type Order = { inbox: number[]; working: number[] };

export type Data = {
	schema: typeof SCHEMA;
	nextTaskId: number;
	nextLabelId: number;
	nextUpdateId: number;
	tasks: Task[];
	labels: Label[];
	relationTypes: RelationType[];
	order: Order;
	/** The Tasks toolbar's filter row, in order: what each filter shows and which ones group. */
	filters: FilterSetting[];
};

export class InvalidInput extends Error {}
const fail = (message: string): never => {
	throw new InvalidInput(message);
};

// ── seed ────────────────────────────────────────────────────────────────

export function seed(): Data {
	const labels: Label[] = [
		{ id: 1, name: "Project", type: "string", color: "blue", values: [], freeform: true, valueColors: true },
		{ id: 2, name: "isPersonal", type: "bool", color: "violet", values: [], freeform: false },
		{
			id: 3,
			name: "Priority",
			type: "string",
			color: "orange",
			values: [
				{ text: "High", color: "red" },
				{ text: "Medium", color: "amber" },
				{ text: "Low", color: "sky" },
			],
			freeform: false,
			shades: "strongest-first",
		},
		{
			id: 4,
			name: "Status",
			type: "string",
			color: "emerald",
			values: [
				{ text: "Todo", color: "sky" },
				{ text: "In progress", color: "violet" },
				{ text: "Blocked", color: "rose" },
			],
			freeform: false,
			valueColors: true,
		},
	];
	return {
		schema: SCHEMA,
		nextTaskId: 1,
		nextLabelId: labels.length + 1,
		nextUpdateId: 1,
		tasks: [],
		filters: defaultFilters({ labels }),
		labels,
		relationTypes: [
			{ id: "parent", name: "Parent", inverse: "Child" },
			{ id: "relatedTo", name: "Related to", inverse: "Related to" },
			{ id: "supersedes", name: "Supersedes", inverse: "Superseded by" },
			{ id: "blocks", name: "Blocks", inverse: "Blocked by" },
		],
		order: { inbox: [], working: [] },
	};
}

// ── due dates ───────────────────────────────────────────────────────────

const DUE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2}))?$/;

/** Normalizes typed input ("2026-11-20", "2026-11-20 9:30") to the stored form, or undefined for blank. */
export function parseDue(input: string): string | undefined {
	const text = input.trim();
	if (!text) return undefined;
	const m = DUE.exec(text) ?? fail("Use a date like 2026-11-20, optionally with a time: 2026-11-20 14:30.");
	const [y, mo, d, h, mi] = [m[1], m[2], m[3], m[4], m[5]].map((v) => (v === undefined ? undefined : Number(v)));
	const date = new Date(y!, mo! - 1, d!);
	if (date.getFullYear() !== y || date.getMonth() !== mo! - 1 || date.getDate() !== d) fail(`${text} is not a real date.`);
	if (h !== undefined && (h > 23 || mi! > 59)) fail(`${text} has an invalid time.`);
	const day = `${m[1]}-${m[2]}-${m[3]}`;
	return h === undefined ? day : `${day}T${String(h).padStart(2, "0")}:${m[5]}`;
}

/** The moment a task becomes overdue: its time, or the end of its day when it has none. */
export function dueAt(due: string): number {
	const [day, time] = due.split("T");
	const [y, mo, d] = day!.split("-").map(Number);
	if (!time) return new Date(y!, mo! - 1, d! + 1).getTime() - 1;
	const [h, mi] = time.split(":").map(Number);
	return new Date(y!, mo! - 1, d!, h, mi).getTime();
}


// ── labels ──────────────────────────────────────────────────────────────

/**
 * A value as the label editor sends it: `from` is its text when the editor opened (absent for
 * a new value), so a changed text is a rename; `color` is kept, or one is picked when absent.
 */
export type LabelValueInput = { text: string; color?: string; from?: string };

export type LabelInput = { name: string; type: LabelType; color: string; values: LabelValueInput[]; freeform: boolean; valueColors?: boolean; shades?: string };

const isHue = (c: unknown): c is Hue => (HUES as readonly unknown[]).includes(c);

/** The color for one more value of `values`: one they use least (see `leastUsedHue`). */
export const nextValueColor = (values: readonly LabelValue[], random?: () => number) => leastUsedHue(values.map((v) => v.color), random);

/** A checked label, and the renames to apply to tasks (old text → new text). */
function checkLabel(data: Data, input: LabelInput, id?: number, random?: () => number): { label: Omit<Label, "id">; renames: Map<string, string> } {
	const name = input.name.trim() || fail("A label needs a name.");
	if (data.labels.some((l) => l.id !== id && l.name.toLowerCase() === name.toLowerCase())) fail(`There is already a label named ${name}.`);
	if (input.type !== "string" && input.type !== "bool") fail("A label is either text or yes/no.");
	if (!isHue(input.color)) fail(`${input.color} is not a label color.`);
	if (input.shades && !(LABEL_SHADES as readonly string[]).includes(input.shades)) fail(`${input.shades} is not a way to shade values.`);
	const values: LabelValue[] = [];
	const renames = new Map<string, string>();
	if (input.type === "string")
		for (const v of input.values) {
			const text = v.text.trim();
			if (!text) continue;
			if (v.from !== undefined && v.from !== text) renames.set(v.from, text);
			// Renaming onto another value merges the two: the first keeps its place and color.
			if (values.some((x) => x.text === text)) continue;
			values.push({ text, color: isHue(v.color) ? v.color : nextValueColor(values, random) });
		}
	const string = input.type === "string";
	const valueColors = string && !!input.valueColors;
	// Shades need one color and at least two values to differ.
	const shades = string && !valueColors && values.length > 1 && input.shades ? (input.shades as LabelShades) : undefined;
	return {
		label: { name, type: input.type, color: input.color as Hue, values, freeform: string && input.freeform, ...(valueColors && { valueColors: true as const }), ...(shades && { shades }) },
		renames,
	};
}

const valueIndex = (label: Label, value: string | boolean) => (typeof value === "string" ? label.values.findIndex((v) => v.text === value) : -1);

/** A listed value's intensity, 0 (lightest) to 1 (the full color), when its label shades values. */
export function shadeOf(label: Label, value: string | boolean): number | undefined {
	if (!label.shades || label.valueColors) return undefined;
	const i = valueIndex(label, value);
	const n = label.values.length;
	if (i < 0 || n < 2) return undefined;
	const strength = 1 - i / (n - 1);
	return label.shades === "strongest-first" ? strength : 1 - strength;
}

/** The color a task's value is drawn in: its own with `valueColors`, else the label's. */
export function colorOf(label: Label, value: string | boolean): Hue {
	return (label.valueColors && label.values[valueIndex(label, value)]?.color) || label.color;
}

export function addLabel(data: Data, input: LabelInput, random?: () => number): Label {
	const { label: checked } = checkLabel(data, input, undefined, random);
	const label = { id: data.nextLabelId++, ...checked };
	data.labels.push(label);
	return label;
}

/**
 * Edits a label. Renamed values are renamed on the tasks that carry them (renaming onto another
 * value merges them); values no longer listed are removed from tasks, as is everything when the
 * label becomes yes/no.
 */
export function updateLabel(data: Data, id: number, input: LabelInput, now: number, random?: () => number): Label {
	const label = findLabel(data, id);
	const { label: checked, renames } = checkLabel(data, input, id, random);
	delete label.shades;
	delete label.valueColors;
	Object.assign(label, checked);
	for (const task of data.tasks) {
		const value = task.labels[id];
		if (value === undefined) continue;
		const renamed = typeof value === "string" ? renames.get(value) : undefined;
		if (renamed !== undefined) {
			task.labels[id] = renamed;
			task.updated = now;
		}
		if (!listed(label, task.labels[id]!)) {
			delete task.labels[id];
			task.updated = now;
		}
	}
	return label;
}

/** How many tasks carry each of a label's values (all tasks, archived too). */
export function valueCounts(data: Data, label: Label): Map<string, number> {
	const counts = new Map<string, number>();
	for (const t of data.tasks) {
		const v = t.labels[label.id];
		if (typeof v === "string") counts.set(v, (counts.get(v) ?? 0) + 1);
	}
	return counts;
}

export function deleteLabel(data: Data, id: number, now: number) {
	findLabel(data, id);
	data.labels = data.labels.filter((l) => l.id !== id);
	for (const task of data.tasks)
		if (id in task.labels) {
			delete task.labels[id];
			task.updated = now;
		}
}

export const findLabel = (data: Data, id: number) => data.labels.find((l) => l.id === id) ?? fail(`Label ${id} no longer exists.`);

/** A value the label has: yes for yes/no labels, a listed value for text labels. */
const listed = (label: Label, value: string | boolean) => (label.type === "bool" ? value === true : valueIndex(label, value) >= 0);
/** A value a task may be given: a listed one, or any text when tasks can add values. */
const allowed = (label: Label, value: string | boolean) => listed(label, value) || (label.type === "string" && label.freeform && typeof value === "string" && value !== "");

/** Typed values new to their label join its list, each with a color of its own. */
function rememberValues(data: Data, labels: Task["labels"], random?: () => number) {
	for (const [id, value] of Object.entries(labels)) {
		const label = data.labels.find((l) => String(l.id) === id);
		if (label && typeof value === "string" && !listed(label, value)) label.values.push({ text: value, color: nextValueColor(label.values, random) });
	}
}

// ── tasks ───────────────────────────────────────────────────────────────

export type TaskInput = { name: string; due: string; desc: string; labels: Record<string, string | boolean> };

function checkTask(data: Data, input: TaskInput): Pick<Task, "name" | "due" | "desc" | "labels"> {
	const name = input.name.trim() || fail("A task needs a name.");
	const labels: Task["labels"] = {};
	for (const [key, raw] of Object.entries(input.labels)) {
		const label = findLabel(data, Number(key));
		const value = typeof raw === "string" ? raw.trim() : raw;
		if (value === "" || value === false) continue;
		if (!allowed(label, value)) fail(`${String(value)} is not a value of ${label.name}.`);
		labels[label.id] = value;
	}
	return { name, due: parseDue(input.due), desc: input.desc, labels };
}

export function addTask(data: Data, input: TaskInput, now: number, random?: () => number): Task {
	const checked = checkTask(data, input);
	rememberValues(data, checked.labels, random);
	const task: Task = {
		id: data.nextTaskId++,
		created: now,
		updated: now,
		relations: [],
		...checked,
		state: "inbox",
		archived: false,
		unread: false,
		sessions: [],
		updates: [],
	};
	if (task.due === undefined) delete task.due;
	data.tasks.push(task);
	// New tasks go on top of the Inbox, above the ones already arranged.
	data.order.inbox.unshift(task.id);
	return task;
}

export function updateTask(data: Data, id: number, input: TaskInput, now: number, random?: () => number): Task {
	const task = findTask(data, id);
	const next = checkTask(data, input);
	rememberValues(data, next.labels, random);
	Object.assign(task, next, { updated: now });
	if (next.due === undefined) delete task.due;
	// A new due date is announced again when it arrives.
	if (task.dueAnnounced !== task.due) delete task.dueAnnounced;
	return task;
}

/** Deletes a task and every relation pointing at it. */
export function deleteTask(data: Data, id: number, now: number) {
	findTask(data, id);
	data.tasks = data.tasks.filter((t) => t.id !== id);
	for (const key of ["inbox", "working"] as const) data.order[key] = data.order[key].filter((x) => x !== id);
	for (const task of data.tasks) {
		const kept = task.relations.filter((r) => r.task !== id);
		if (kept.length !== task.relations.length) {
			task.relations = kept;
			task.updated = now;
		}
	}
}

export const findTask = (data: Data, id: number) => data.tasks.find((t) => t.id === id) ?? fail(`Task #${id} no longer exists.`);

// ── updates ─────────────────────────────────────────────────────────────

/** A minute's grace for clocks and for times picked to the minute. */
const SKEW = 60_000;

const checkText = (text: string) => (text.trim() ? text.replace(/\s+$/, "") : fail("Write what happened first."));

/** Adds a progress note to a task, as of now. */
export function addUpdate(data: Data, taskId: number, text: string, now: number): Update {
	const task = findTask(data, taskId);
	const update: Update = { id: data.nextUpdateId++, added: now, updated: now, text: checkText(text) };
	task.updates.push(update);
	task.updated = now;
	return update;
}

export const findUpdate = (task: Task, id: number) => task.updates.find((u) => u.id === id) ?? fail("That update no longer exists.");

/**
 * Edits a note. `added`/`updated` correct its times; left out, `added` stays and `updated`
 * becomes now when the text changed. Neither can be in the future, nor last updated before added.
 */
export function editUpdate(data: Data, taskId: number, id: number, input: { text: string; added?: number; updated?: number }, now: number): Update {
	const task = findTask(data, taskId);
	const update = findUpdate(task, id);
	const text = checkText(input.text);
	const added = input.added ?? update.added;
	const updated = input.updated ?? (text !== update.text ? now : Math.max(update.updated, added));
	if (added > now + SKEW || updated > now + SKEW) fail("An update can't be from the future.");
	if (updated < added) fail("Last updated can't be before it was added.");
	Object.assign(update, { text, added, updated });
	task.updated = now;
	return update;
}

export function deleteUpdate(data: Data, taskId: number, id: number, now: number) {
	const task = findTask(data, taskId);
	findUpdate(task, id);
	task.updates = task.updates.filter((u) => u.id !== id);
	task.updated = now;
}

/** Newest first: by when they were added, then by when they were written. */
export const updatesOf = (task: Task) => [...task.updates].sort((a, b) => b.added - a.added || b.id - a.id);

/** Epoch ms → the local `YYYY-MM-DDTHH:MM` a datetime field shows. */
export function toLocalInput(ms: number) {
	const d = new Date(ms);
	const p = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * A datetime field's value → epoch ms. Unchanged (`was` shows the same minute) keeps `was`
 * exactly; a date alone keeps `was`'s time of day. Blank is refused: `what` names the field.
 */
export function fromLocalInput(value: string, was: number, what: string): number {
	if (value === toLocalInput(was)) return was;
	const local = parseDue(value) ?? fail(`${what} needs a date and time.`);
	const [day, time] = local.split("T");
	const [y, mo, d] = day!.split("-").map(Number);
	const at = new Date(was);
	const [h, mi] = time ? time.split(":").map(Number) : [at.getHours(), at.getMinutes()];
	return new Date(y!, mo! - 1, d!, h, mi).getTime();
}

// ── relations ───────────────────────────────────────────────────────────

/**
 * Relates two tasks. `inverse` records it from the other side ("Child of #7" is stored on #7 as
 * "Parent of" this task) so each relation exists exactly once.
 */
export function relate(data: Data, from: number, type: string, to: number, inverse: boolean, now: number) {
	findRelationType(data, type);
	if (from === to) fail("A task can't be related to itself.");
	const [holder, target] = inverse ? [findTask(data, to), findTask(data, from)] : [findTask(data, from), findTask(data, to)];
	if (relationsOf(data, holder.id).some((r) => r.task === target.id && r.type === type)) fail("These tasks are already related that way.");
	if (type === "parent" && wouldCycle(data, holder.id, target.id)) fail("That would make a task its own ancestor.");
	holder.relations.push({ task: target.id, type });
	holder.updated = target.updated = now;
}

export function unrelate(data: Data, holder: number, type: string, target: number, now: number) {
	const task = findTask(data, holder);
	const kept = task.relations.filter((r) => !(r.task === target && r.type === type));
	if (kept.length === task.relations.length) fail("That relation no longer exists.");
	task.relations = kept;
	task.updated = now;
	const other = data.tasks.find((t) => t.id === target);
	if (other) other.updated = now;
}

/** Following `parent` links up from `parent`, do we reach `child`? */
function wouldCycle(data: Data, child: number, parent: number) {
	const seen = new Set<number>();
	for (let at: number | undefined = parent; at !== undefined && !seen.has(at); ) {
		if (at === child) return true;
		seen.add(at);
		at = data.tasks.find((t) => t.id === at)?.relations.find((r) => r.type === "parent")?.task;
	}
	return false;
}

/** A relation as seen from one task: its holder, type and which way it reads. */
export type SeenRelation = { holder: number; task: number; type: string; label: string; inverse: boolean };

/** Every relation touching a task, outgoing first, each named from this task's side. */
export function relationsOf(data: Data, id: number): SeenRelation[] {
	const names = new Map(data.relationTypes.map((t) => [t.id, t]));
	const out: SeenRelation[] = (data.tasks.find((t) => t.id === id)?.relations ?? []).map((r) => ({
		holder: id,
		task: r.task,
		type: r.type,
		label: names.get(r.type)?.name ?? r.type,
		inverse: false,
	}));
	for (const t of data.tasks)
		for (const r of t.relations)
			if (r.task === id) out.push({ holder: t.id, task: t.id, type: r.type, label: names.get(r.type)?.inverse ?? r.type, inverse: true });
	return out;
}

export const findRelationType = (data: Data, id: string) =>
	data.relationTypes.find((t) => t.id === id) ?? fail(`Relation type ${id} no longer exists.`);

export function saveRelationType(data: Data, input: { id?: string; name: string; inverse: string }) {
	const name = input.name.trim() || fail("A relation type needs a name.");
	const inverse = input.inverse.trim() || name;
	if (input.id) {
		Object.assign(findRelationType(data, input.id), { name, inverse });
		return;
	}
	const base = name.toLowerCase().replace(/[^a-z0-9]+(.)?/g, (_, c: string | undefined) => (c ?? "").toUpperCase()) || "relation";
	let id = base;
	for (let n = 2; data.relationTypes.some((t) => t.id === id); n++) id = `${base}${n}`;
	data.relationTypes.push({ id, name, inverse });
}

export function deleteRelationType(data: Data, id: string) {
	findRelationType(data, id);
	const used = data.tasks.filter((t) => t.relations.some((r) => r.type === id)).length;
	if (used) fail(`${used} task${used === 1 ? " uses" : "s use"} this relation type. Remove those relations first.`);
	data.relationTypes = data.relationTypes.filter((t) => t.id !== id);
}

// ── loading ─────────────────────────────────────────────────────────────

/** Checks a parsed data file's shape, so a damaged file fails loudly instead of half-loading. */
export function parseData(value: unknown): Data {
	const d = value as Data;
	if (!d || typeof d !== "object" || d.schema !== SCHEMA) fail(`Unsupported data schema ${String((d as Data | undefined)?.schema)}.`);
	if (!Array.isArray(d.tasks) || !Array.isArray(d.labels) || !Array.isArray(d.relationTypes)) fail("The data file is damaged.");
	if (!Number.isInteger(d.nextTaskId) || !Number.isInteger(d.nextLabelId) || !Number.isInteger(d.nextUpdateId)) fail("The data file is damaged.");
	if (d.tasks.some((t) => !Array.isArray(t?.updates))) fail("The data file is damaged.");
	if (d.tasks.some((t) => t.watch !== undefined && (typeof t.watch?.since !== "number" || !Number.isInteger(t.watch.checks)))) fail("The data file is damaged.");
	if (!d.order || !Array.isArray(d.order.inbox) || !Array.isArray(d.order.working)) fail("The data file is damaged.");
	if (d.labels.some((l) => !Array.isArray(l?.values) || l.values.some((v) => typeof v?.text !== "string" || !isHue(v.color)))) fail("The data file is damaged.");
	if (!Array.isArray(d.filters)) fail("The data file is damaged.");
	// The filter row follows the labels (it's repaired, not refused).
	d.filters = normalizeFilters(d);
	return d;
}

/**
 * Schema 1 → 2: tasks get a lifecycle. Tasks whose Status was Done become settled (Settled now
 * means done); everything else waits in the Inbox in ID order, nothing pinned or unread.
 */
export function upgrade1to2(old: any): any {
	if (!old || old.schema !== 1 || !Array.isArray(old.tasks)) fail("Expected schema 1 data.");
	const status = (old.labels as Label[]).find((l) => l.name.toLowerCase() === "status");
	const tasks: Omit<Task, "updates">[] = (old.tasks as Task[]).map((t) => {
		const value = status ? t.labels[status.id] : undefined;
		const done = typeof value === "string" && value.toLowerCase() === "done";
		return { ...t, state: done ? "settled" : "inbox", ...(done && { settledAt: t.updated }), pinned: false, archived: false, unread: false, sessions: [] };
	});
	return {
		...old,
		schema: 2,
		tasks,
		order: { pinned: [], inbox: tasks.filter((t) => t.state === "inbox").map((t) => t.id), working: [] },
	};
}

/** Schema 2 → 3: tasks get progress notes (updates), none yet. */
export function upgrade2to3(old: any): any {
	if (!old || old.schema !== 2 || !Array.isArray(old.tasks)) fail("Expected schema 2 data.");
	return { ...old, schema: 3, nextUpdateId: 1, tasks: old.tasks.map((t: Task) => ({ ...t, updates: [] })) };
}

/**
 * Schema 3 → 4: tasks can be watched (state `watching`, `watch`; no task is yet), and pinning
 * is gone. Pins become a yes/no label "Pinned" (made only when some task was pinned, or reused
 * when a yes/no label of that name exists), so nothing is lost and it can be filtered by.
 */
export function upgrade3to4(old: any): any {
	if (!old || old.schema !== 3 || !Array.isArray(old.tasks)) fail("Expected schema 3 data.");
	const { pinned: _order, ...order } = old.order ?? {};
	let labels: Label[] = old.labels;
	let nextLabelId: number = old.nextLabelId;
	let label: Label | undefined;
	if (old.tasks.some((t: any) => t.pinned)) {
		const named = (name: string) => labels.find((l) => l.name.toLowerCase() === name.toLowerCase());
		label = named("Pinned")?.type === "bool" ? named("Pinned") : undefined;
		if (!label) {
			let name = "Pinned";
			for (let n = 2; named(name); n++) name = `Pinned ${n}`;
			label = { id: nextLabelId++, name, type: "bool", color: "amber", values: [], freeform: false };
			labels = [...labels, label];
		}
	}
	const tasks = old.tasks.map(({ pinned, ...t }: any) => (pinned && label ? { ...t, labels: { ...t.labels, [label.id]: true } } : t));
	return { ...old, schema: 4, nextLabelId, labels, tasks, order: { inbox: order.inbox ?? [], working: order.working ?? [] } };
}

/**
 * Schema 4 → 5: a text label's values become one list with a color each. Listed values get
 * colors the label uses least, in list order; values tasks typed into a free-text label join its
 * list after them (A–Z). Labels keep showing one color until the person chooses otherwise.
 */
export function upgrade4to5(old: any, random?: () => number): Omit<Data, "schema" | "filters"> & { schema: 5 } {
	if (!old || old.schema !== 4 || !Array.isArray(old.tasks) || !Array.isArray(old.labels)) fail("Expected schema 4 data.");
	const labels: Label[] = old.labels.map((l: any) => {
		const values: LabelValue[] = [];
		const add = (text: string, color?: unknown) => !values.some((v) => v.text === text) && values.push({ text, color: isHue(color) ? color : nextValueColor(values, random) });
		if (l.type === "string") {
			for (const v of l.values ?? []) {
				// Retry-safe: values already in the new shape keep their colors.
				const text = typeof v === "string" ? v.trim() : typeof v?.text === "string" ? v.text.trim() : "";
				if (text) add(text, v?.color);
			}
			const typed = old.tasks.map((t: any) => t.labels?.[l.id]).filter((v: unknown): v is string => typeof v === "string" && v !== "");
			for (const v of [...new Set<string>(typed)].sort((a, b) => a.localeCompare(b))) add(v);
		}
		return { ...l, values };
	});
	return { ...old, schema: 5, labels };
}

/**
 * Schema 5 → 6: the Tasks toolbar's filter row is saved (Status grouping and showing Ongoing,
 * as the list looked; Due and each label after it), and archived tasks remember when they were
 * archived (taken as their last change), so the Archived group can show newest first.
 */
export function upgrade5to6(old: any): Data {
	if (!old || old.schema !== 5 || !Array.isArray(old.tasks) || !Array.isArray(old.labels)) fail("Expected schema 5 data.");
	const tasks = old.tasks.map((t: any) => (t.archived && t.archivedAt === undefined ? { ...t, archivedAt: t.updated } : t));
	return { ...old, schema: SCHEMA, tasks, filters: normalizeFilters({ labels: old.labels, filters: old.filters }) };
}
