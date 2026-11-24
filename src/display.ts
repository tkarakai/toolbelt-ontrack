// How the Tasks list is filtered and grouped. One row of filters (Status, Due and one per label)
// both narrows the list and, for the filters whose Group by is on, nests it into groups in the
// row's order. Pure: no I/O, no SDK runtime; the settings live in the data file.
import type { Section } from "@toolbelt/sdk";
import { dueAt, type Data, type Label, type Task, type TaskState } from "./model";

/** One filter of the row: which values it shows (none: all) and whether it groups. */
export type FilterSetting = { id: string; group: boolean; selected: string[] };

/** How deep grouping may nest, counting Progressing's own level (Toolbelt's `MAX_SECTION_DEPTH`). */
export const MAX_LEVELS = 10;

export const STATUS = "status";
export const DUE = "due";
export const labelFilterId = (label: Pick<Label, "id">) => `label:${label.id}`;

/** The Status filter's values, in list order: the five states, then Archived. */
export const STATUS_VALUES = ["inbox", "working", "snoozed", "watching", "settled", "archived"] as const;
export type StatusValue = (typeof STATUS_VALUES)[number];
/** Status starts on everything but Archived: "Ongoing". */
export const ONGOING: StatusValue[] = ["inbox", "working", "snoozed", "watching", "settled"];
export const STATUS_LABELS: Record<StatusValue, string> = { inbox: "Inbox", working: "Working on it", snoozed: "Snoozed", watching: "Watching", settled: "Settled", archived: "Archived" };
/** The states shown together under Progressing. */
export const PROGRESSING_STATES: StatusValue[] = ["working", "snoozed", "watching"];

/** Due buckets, in list order. Overdue is for open tasks; a finished task's past date is Past. */
export const DUE_BUCKETS = [
	{ id: "overdue", label: "Overdue" },
	{ id: "today", label: "Today" },
	{ id: "next6", label: "Next 6 days" },
	{ id: "later", label: "Later" },
	{ id: "past", label: "Past" },
	{ id: "none", label: "No date" },
] as const;
export type DueBucket = (typeof DUE_BUCKETS)[number]["id"];

/** A label filter's value for "no value" (a task without the label). */
export const NO_VALUE = "__none";
/** A yes/no label's value when it's on. */
export const YES = "yes";

// ── the filter row ──────────────────────────────────────────────────────

/** A fresh row: Status grouping, showing Ongoing; Due and every label after it, not grouping. */
export function defaultFilters(data: Pick<Data, "labels">): FilterSetting[] {
	return [{ id: STATUS, group: true, selected: [...ONGOING] }, { id: DUE, group: false, selected: [] }, ...data.labels.map((l) => ({ id: labelFilterId(l), group: false, selected: [] }))];
}

/** The values a filter can show, in list order. */
export function filterValues(data: Pick<Data, "labels">, id: string): string[] {
	if (id === STATUS) return [...STATUS_VALUES];
	if (id === DUE) return DUE_BUCKETS.map((b) => b.id);
	const label = labelOf(data, id);
	if (!label) return [];
	return label.type === "bool" ? [YES, NO_VALUE] : [...label.values.map((v) => v.text), NO_VALUE];
}

const labelOf = (data: Pick<Data, "labels">, id: string) => (id.startsWith("label:") ? data.labels.find((l) => labelFilterId(l) === id) : undefined);

/** Levels a filter adds when it groups: Status adds Progressing's too. */
export const levelsOf = (id: string) => (id === STATUS ? 2 : 1);
export const groupedLevels = (filters: FilterSetting[]) => filters.reduce((n, f) => n + (f.group ? levelsOf(f.id) : 0), 0);

/**
 * The row repaired against the labels: every filter once (Status, Due, each label), labels that
 * are gone left out, new ones first among those not grouping, selections only of values that
 * still exist, and grouping cut off at `MAX_LEVELS`.
 */
export function normalizeFilters(data: Pick<Data, "labels"> & { filters?: FilterSetting[] }): FilterSetting[] {
	const known = defaultFilters(data);
	const ids = new Set(known.map((f) => f.id));
	const seen = new Set<string>();
	const kept: FilterSetting[] = [];
	for (const f of Array.isArray(data.filters) ? data.filters : []) {
		if (!f || typeof f.id !== "string" || !ids.has(f.id) || seen.has(f.id)) continue;
		seen.add(f.id);
		const values = new Set(filterValues(data, f.id));
		kept.push({ id: f.id, group: f.group === true, selected: Array.isArray(f.selected) ? [...new Set(f.selected.filter((v) => typeof v === "string" && values.has(v)))] : [] });
	}
	const missing = known.filter((f) => !seen.has(f.id));
	const grouped = kept.filter((f) => f.group);
	const rest = kept.filter((f) => !f.group);
	// Built-in filters that were missing keep their defaults; new labels come first among the rest.
	const out = [...grouped, ...missing.filter((f) => f.group), ...missing.filter((f) => !f.group && !f.id.startsWith("label:")), ...missing.filter((f) => f.id.startsWith("label:")), ...rest];
	let levels = 0;
	return out.map((f) => {
		if (!f.group) return f;
		levels += levelsOf(f.id);
		return levels > MAX_LEVELS ? { ...f, group: false } : f;
	});
}

/** A new selection for one filter (values it doesn't have are dropped). */
export function setSelection(data: Data, id: string, values: unknown) {
	const allowed = new Set(filterValues(data, id));
	const f = data.filters.find((x) => x.id === id);
	if (!f) return;
	f.selected = Array.isArray(values) ? [...new Set(values.map(String).filter((v) => allowed.has(v)))] : [];
}

/**
 * A new arrangement from the toolbar: every filter in `order`, the `grouped` ones grouping in
 * that order. Unknown ids are ignored and missing ones keep their place after the rest; grouping
 * beyond `MAX_LEVELS` is refused.
 */
export function arrange(data: Data, order: unknown, grouped: unknown) {
	const ids = Array.isArray(order) ? order.map(String) : [];
	const on = new Set(Array.isArray(grouped) ? grouped.map(String) : []);
	const byId = new Map(data.filters.map((f) => [f.id, f]));
	const listed = ids.filter((id, i) => byId.has(id) && ids.indexOf(id) === i);
	const next = [...listed, ...data.filters.map((f) => f.id).filter((id) => !listed.includes(id))].map((id) => ({ ...byId.get(id)!, group: on.has(id) }));
	if (groupedLevels(next) > MAX_LEVELS) throw new RangeError(`Grouping goes ${MAX_LEVELS} levels deep at most.`);
	// Grouping filters lead, in level order.
	data.filters = [...next.filter((f) => f.group), ...next.filter((f) => !f.group)];
}

// ── where a task falls ──────────────────────────────────────────────────

export const statusOf = (task: Task): StatusValue => (task.archived ? "archived" : task.state);

/** Done with: settled or archived. Their past dates aren't overdue. */
const finished = (task: Task) => task.archived || task.state === "settled";

const startOfDay = (ms: number) => {
	const d = new Date(ms);
	return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

/** The task's due bucket now. */
export function dueBucket(task: Task, now: number): DueBucket {
	if (!task.due) return "none";
	if (!finished(task) && dueAt(task.due) < now) return "overdue";
	const [y, m, d] = task.due.slice(0, 10).split("-").map(Number);
	const days = Math.round((new Date(y!, m! - 1, d!).getTime() - startOfDay(now)) / 86_400_000);
	return days < 0 ? "past" : days === 0 ? "today" : days <= 6 ? "next6" : "later";
}

/** The task's value for a filter: its status, due bucket or label value (`NO_VALUE` without one). */
export function valueOf(data: Pick<Data, "labels">, id: string, task: Task, now: number): string {
	if (id === STATUS) return statusOf(task);
	if (id === DUE) return dueBucket(task, now);
	const label = labelOf(data, id);
	const v = label ? task.labels[label.id] : undefined;
	return v === undefined ? NO_VALUE : v === true ? YES : String(v);
}

/** Whether the task passes every filter (`except` one, for its own counts). */
export function passes(data: Data, task: Task, now: number, except?: string): boolean {
	return data.filters.every((f) => f.id === except || !f.selected.length || f.selected.includes(valueOf(data, f.id, task, now)));
}

// ── groups ──────────────────────────────────────────────────────────────

/**
 * A group's segment of a section id: a Status value as it is (`inbox`, `working`, as the
 * sections were always named), else `d=<bucket>` for Due or `l<id>=<value>` for a label.
 */
const segment = (id: string, value: string) => (id === STATUS ? value : `${id === DUE ? "d" : `l${id.slice("label:".length)}`}=${encodeURIComponent(value)}`);
const idOfCode = (code: string) => (code === "d" ? DUE : /^l\d+$/.test(code) ? `label:${code.slice(1)}` : "");
/** Progressing: a Status group with no tasks of its own; its states are its sections. */
export const PROGRESSING = "progressing";

/** One group's header: its label, icon and how it takes drops. */
export type GroupLook = Pick<Section, "label" | "icon" | "empty" | "collapsed" | "muted" | "dropLabel" | "dropIcon" | "order">;

/** How a group looks, given by the screen (icons and drop names are the UI's to choose). */
export type Looks = {
	status(value: StatusValue | "progressing"): GroupLook;
	due(bucket: DueBucket): GroupLook;
	label(label: Label, value: string): GroupLook;
};

/**
 * The table's sections for the grouping filters, nested in the row's order, and each task's
 * group (its innermost section's id). Only groups with tasks show, except at the top level of a
 * Status grouping, where each selected state shows even when empty, as before. Settled and
 * Archived start collapsed. A section's id is its path of `<filter code>=<value>` segments, so
 * a drop names every value it means.
 */
export function groupTasks(data: Data, tasks: Task[], now: number, looks: Looks): { sections: Section[]; groupOf: Map<number, string> } {
	const levels = data.filters.filter((f) => f.group);
	const groupOf = new Map<number, string>();
	if (!levels.length) return { sections: [], groupOf };
	const build = (pool: Task[], depth: number, path: string[], top: boolean): Section[] => {
		const f = levels[depth];
		if (!f) {
			for (const t of pool) groupOf.set(t.id, path.join("/"));
			return [];
		}
		const shownValues = f.selected.length ? filterValues(data, f.id).filter((v) => f.selected.includes(v)) : filterValues(data, f.id);
		const node = (value: string, members: Task[], at: string[], look: GroupLook, always: boolean): Section | null => {
			if (!members.length && !always) return null;
			const id = [...at, segment(f.id, value)];
			const sections = build(members, depth + 1, id, false);
			// A group whose tasks all sit in groups below it has those as its sections.
			const leaf = depth === levels.length - 1;
			return { id: id.join("/"), ...look, order: leaf ? look.order : look.order === false ? false : "fixed", ...(sections.length && { sections }) };
		};
		const by = (value: string) => pool.filter((t) => valueOf(data, f.id, t, now) === value);
		if (f.id === STATUS) {
			const out: Section[] = [];
			const progressing = PROGRESSING_STATES.filter((v) => shownValues.includes(v));
			for (const value of shownValues) {
				if (PROGRESSING_STATES.includes(value as StatusValue)) {
					if (value !== progressing[0]) continue;
					// Progressing: its states one level further in (their ids don't name it, as before).
					const subs = progressing.map((v) => node(v, by(v), path, looks.status(v as StatusValue), top)).filter((s): s is Section => !!s);
					if (subs.length || top) out.push({ id: [...path, PROGRESSING].join("/"), ...looks.status("progressing"), sections: subs });
					continue;
				}
				const s = node(value, by(value), path, looks.status(value as StatusValue), top && value !== "archived");
				if (s) out.push(s);
			}
			return out;
		}
		const look = (value: string): GroupLook => {
			if (f.id === DUE) return looks.due(value as DueBucket);
			return looks.label(labelOf(data, f.id)!, value);
		};
		return shownValues.map((v) => node(v, by(v), path, look(v), false)).filter((s): s is Section => !!s);
	};
	return { sections: build(tasks, 0, [], true), groupOf };
}

/** What a drop into a section means: each filter's value along its path (Progressing means working). */
export function dropTarget(sectionId: string): Map<string, string> {
	const out = new Map<string, string>();
	const parts = sectionId.split("/").filter(Boolean);
	for (const part of parts) {
		const eq = part.indexOf("=");
		if (eq < 0) {
			// A drop on Progressing itself starts work.
			if (part === PROGRESSING) out.set(STATUS, "working");
			else if ((STATUS_VALUES as readonly string[]).includes(part)) out.set(STATUS, part);
			continue;
		}
		const id = idOfCode(part.slice(0, eq));
		if (id) out.set(id, decodeURIComponent(part.slice(eq + 1)));
	}
	return out;
}

/** The state a Status value means (Archived is a flag: the task keeps its state). */
export const stateOf = (value: string): TaskState | undefined => (value === "archived" || !(STATUS_VALUES as readonly string[]).includes(value) ? undefined : (value as TaskState));
