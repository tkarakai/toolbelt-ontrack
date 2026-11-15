// OnTrack's data model and the pure operations on it. Nothing here touches the disk or the SDK,
// so every rule is testable on plain objects.
import { HUES, type Hue } from "@toolbelt/sdk";

export const SCHEMA = 2;

export type LabelType = "string" | "bool";

/**
 * A label is a named, colored attribute a task can carry with one value.
 * - `bool` labels are either present (true) or absent; they have no values.
 * - `string` labels pick from `values` (a lookup list). With `freeform`, any text is accepted
 *   and `values` are only suggestions; a freeform label with no values is plain text.
 */
export type Label = {
	id: number;
	name: string;
	type: LabelType;
	color: Hue;
	values: string[];
	freeform: boolean;
};

/**
 * How one task relates to another. Stored once on the task that holds it, read from both sides:
 * `{ task: 7, type: "parent" }` on task 3 reads "Parent: #7" on 3 and "Child: #3" on 7.
 */
export type RelationType = { id: string; name: string; inverse: string };

export type Relation = { task: number; type: string };

/**
 * Where a task is in its life, as in T3 Code's thread list: waiting in the Inbox, being worked on,
 * snoozed until a time, or settled (done). Pinning and archiving are separate flags on top.
 */
export type TaskState = "inbox" | "working" | "snoozed" | "settled";

/** A stretch of work on a task, by whoever worked on it ("me" now; an agent later). */
export type Session = { start: number; end?: number; by: string };

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
	/** Shown in Pinned (unless snoozed or settled); keeps its Inbox/Working position. */
	pinned: boolean;
	/** Hidden from the sections; found in the Archived view and by search. */
	archived: boolean;
	/** Something happened since the person last opened it; `unreadReason` says what. */
	unread: boolean;
	unreadReason?: string;
	/** Epoch ms the snooze ends (state `snoozed`). */
	snoozedUntil?: number;
	/** Epoch ms it was settled (state `settled`). */
	settledAt?: number;
	/** The `due` value whose arrival was already announced, so it's announced once. */
	dueAnnounced?: string;
	sessions: Session[];
};

/** The person's order of the sections they arrange; ids not listed go last. */
export type Order = { pinned: number[]; inbox: number[]; working: number[] };

export type Data = {
	schema: typeof SCHEMA;
	nextTaskId: number;
	nextLabelId: number;
	tasks: Task[];
	labels: Label[];
	relationTypes: RelationType[];
	order: Order;
};

export class InvalidInput extends Error {}
const fail = (message: string): never => {
	throw new InvalidInput(message);
};

// ── seed ────────────────────────────────────────────────────────────────

export function seed(): Data {
	const labels: Label[] = [
		{ id: 1, name: "Project", type: "string", color: "blue", values: [], freeform: true },
		{ id: 2, name: "isPersonal", type: "bool", color: "violet", values: [], freeform: false },
		{ id: 3, name: "Priority", type: "string", color: "orange", values: ["High", "Medium", "Low"], freeform: false },
		{ id: 4, name: "Status", type: "string", color: "emerald", values: ["Todo", "In progress", "Blocked"], freeform: false },
	];
	return {
		schema: SCHEMA,
		nextTaskId: 1,
		nextLabelId: labels.length + 1,
		tasks: [],
		labels,
		relationTypes: [
			{ id: "parent", name: "Parent", inverse: "Child" },
			{ id: "relatedTo", name: "Related to", inverse: "Related to" },
			{ id: "supersedes", name: "Supersedes", inverse: "Superseded by" },
			{ id: "blocks", name: "Blocks", inverse: "Blocked by" },
		],
		order: { pinned: [], inbox: [], working: [] },
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

export const formatDue = (due: string) => due.replace("T", " ");

// ── labels ──────────────────────────────────────────────────────────────

export type LabelInput = { name: string; type: LabelType; color: string; values: string[]; freeform: boolean };

function checkLabel(data: Data, input: LabelInput, id?: number): Omit<Label, "id"> {
	const name = input.name.trim() || fail("A label needs a name.");
	if (data.labels.some((l) => l.id !== id && l.name.toLowerCase() === name.toLowerCase())) fail(`There is already a label named ${name}.`);
	if (input.type !== "string" && input.type !== "bool") fail("A label is either text or yes/no.");
	if (!(HUES as readonly string[]).includes(input.color)) fail(`${input.color} is not a label color.`);
	const values = input.type === "bool" ? [] : [...new Set(input.values.map((v) => v.trim()).filter(Boolean))];
	return { name, type: input.type, color: input.color as Hue, values, freeform: input.type === "string" && input.freeform };
}

export function addLabel(data: Data, input: LabelInput): Label {
	const checked = checkLabel(data, input);
	const label = { id: data.nextLabelId++, ...checked };
	data.labels.push(label);
	return label;
}

/** Edits a label. Task values that the new definition no longer allows are dropped. */
export function updateLabel(data: Data, id: number, input: LabelInput, now: number): Label {
	const label = findLabel(data, id);
	Object.assign(label, checkLabel(data, input, id));
	for (const task of data.tasks) {
		const value = task.labels[id];
		if (value !== undefined && !allowed(label, value)) {
			delete task.labels[id];
			task.updated = now;
		}
	}
	return label;
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

const allowed = (label: Label, value: string | boolean) =>
	label.type === "bool" ? value === true : typeof value === "string" && value !== "" && (label.freeform || label.values.includes(value));

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

export function addTask(data: Data, input: TaskInput, now: number): Task {
	const checked = checkTask(data, input);
	const task: Task = {
		id: data.nextTaskId++,
		created: now,
		updated: now,
		relations: [],
		...checked,
		state: "inbox",
		pinned: false,
		archived: false,
		unread: false,
		sessions: [],
	};
	if (task.due === undefined) delete task.due;
	data.tasks.push(task);
	// New tasks go on top of the Inbox, above the ones already arranged.
	data.order.inbox.unshift(task.id);
	return task;
}

export function updateTask(data: Data, id: number, input: TaskInput, now: number): Task {
	const task = findTask(data, id);
	const next = checkTask(data, input);
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
	for (const key of ["pinned", "inbox", "working"] as const) data.order[key] = data.order[key].filter((x) => x !== id);
	for (const task of data.tasks) {
		const kept = task.relations.filter((r) => r.task !== id);
		if (kept.length !== task.relations.length) {
			task.relations = kept;
			task.updated = now;
		}
	}
}

export const findTask = (data: Data, id: number) => data.tasks.find((t) => t.id === id) ?? fail(`Task #${id} no longer exists.`);

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
	if (!Number.isInteger(d.nextTaskId) || !Number.isInteger(d.nextLabelId)) fail("The data file is damaged.");
	if (!d.order || !Array.isArray(d.order.pinned) || !Array.isArray(d.order.inbox) || !Array.isArray(d.order.working)) fail("The data file is damaged.");
	return d;
}

/**
 * Schema 1 → 2: tasks get a lifecycle. Tasks whose Status was Done become settled (Settled now
 * means done); everything else waits in the Inbox in ID order, nothing pinned or unread.
 */
export function upgrade1to2(old: any): Data {
	if (!old || old.schema !== 1 || !Array.isArray(old.tasks)) fail("Expected schema 1 data.");
	const status = (old.labels as Label[]).find((l) => l.name.toLowerCase() === "status");
	const tasks: Task[] = (old.tasks as Task[]).map((t) => {
		const value = status ? t.labels[status.id] : undefined;
		const done = typeof value === "string" && value.toLowerCase() === "done";
		return { ...t, state: done ? "settled" : "inbox", ...(done && { settledAt: t.updated }), pinned: false, archived: false, unread: false, sessions: [] };
	});
	return {
		...old,
		schema: SCHEMA,
		tasks,
		order: { pinned: [], inbox: tasks.filter((t) => t.state === "inbox").map((t) => t.id), working: [] },
	};
}
