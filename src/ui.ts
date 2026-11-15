// Builds OnTrack's surfaces from the data and the plugin's view state. Pure: given the same
// state and clock it returns the same trees, which the tests rely on.
import { HUES, search, type Action, type Cell, type DetailItem, type Dialog as DialogNode, type Field, type Filter, type Node, type Row, type Section, type Tag, type TagKey, type TagValue } from "@toolbelt/sdk";
import { inSection, sectionOf, snoozeChoices, timeSpent, workingSince, type SectionId } from "./lifecycle";
import { dueAt, formatDue, relationsOf, type Data, type Label, type LabelInput, type Task, type TaskInput } from "./model";

export type Dialog =
	| { kind: "task"; id?: number; draft: TaskInput; error?: string }
	| { kind: "relate"; from: number; type: string; to: string; error?: string }
	| { kind: "snooze"; id: number; until: string; error?: string }
	| { kind: "label"; id?: number; draft: Omit<LabelInput, "values"> & { values: string }; error?: string }
	| { kind: "relationType"; id?: string; name: string; inverse: string; error?: string };

export type View = {
	query: string;
	/** Filter id → selected option values. */
	filters: Record<string, string[]>;
	show: "active" | "archived";
	dialog?: Dialog;
};

export const initialView = (): View => ({ query: "", filters: {}, show: "active" });

const NONE = "__none";

// ── shared helpers ──────────────────────────────────────────────────────

/** The task's labels as colored pills, in label order. Yes/no labels show their name. */
export function tags(data: Data, task: Task): Tag[] {
	return data.labels.flatMap((label) => {
		const value = task.labels[label.id];
		if (value === undefined) return [];
		return [{ text: value === true ? label.name : String(value), color: label.color, tooltip: value === true ? undefined : label.name }];
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

function filterOptions(data: Data, label: Label): string[] {
	if (label.type === "bool") return ["yes"];
	const used = data.tasks.map((t) => t.labels[label.id]).filter((v): v is string => typeof v === "string");
	return [...new Set([...label.values, ...used.sort()])];
}

const taskName = (data: Data, id: number) => {
	const task = data.tasks.find((t) => t.id === id);
	return task ? `#${id} ${task.name}` : `#${id}`;
};

/** Overdue: past due and not settled. */
export const isOverdue = (task: Task, now: number) => !!task.due && task.state !== "settled" && dueAt(task.due) < now;

/** What the plugin badge counts: open tasks that are unread or overdue. */
export const attention = (data: Data, now: number) => data.tasks.filter((t) => !t.archived && t.state !== "settled" && (t.unread || isOverdue(t, now))).length;

function matches(data: Data, view: View, task: Task, s: ReturnType<typeof search>) {
	for (const [id, values] of Object.entries(view.filters)) {
		if (!values.length) continue;
		const value = task.labels[id.slice("label:".length)];
		if (value === undefined || !values.includes(optionValue(value))) return false;
	}
	return s.test([`#${task.id}`, task.name, task.desc, ...tags(data, task).map((t) => t.text)]);
}

// ── actions ─────────────────────────────────────────────────────────────

/** Every task action; each row offers the ones that fit its state. */
export function taskActions(now: number): Action[] {
	return [
		{ id: "start", label: "Start working on this", icon: "play", key: "w", inline: true, group: "flow" },
		{ id: "done", label: "Done for now", icon: "inbox", key: "d", inline: true, group: "flow" },
		{ id: "wake", label: "Wake now", icon: "alarm-clock-off", key: "w", inline: true, group: "flow" },
		{ id: "unsettle", label: "Un-settle", icon: "rotate-ccw", key: "s", inline: true, group: "flow" },
		{ id: "settle", label: "Settle", icon: "check", key: "s", group: "flow" },
		{
			id: "snooze",
			label: "Snooze…",
			icon: "alarm-clock",
			key: "z",
			group: "flow",
			menu: snoozeChoices(now).map((c) => ({ id: `snooze:${c.id}`, label: c.label, icon: "alarm-clock" })),
		},
		{ id: "pin", label: "Pin", icon: "pin", key: "p", group: "flow" },
		{ id: "unpin", label: "Unpin", icon: "pin-off", key: "p", group: "flow" },
		{ id: "edit", label: "Edit", icon: "pencil", key: "e", group: "edit" },
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
export function actionsFor(data: Data, task: Task): string[] {
	if (task.archived) return ["unarchive", "edit", "delete"];
	const section = sectionOf(task);
	const ids: string[] = [];
	if (task.state === "inbox") ids.push("start");
	if (task.state === "working") ids.push("done");
	if (task.state === "snoozed") ids.push("wake");
	if (task.state === "settled") ids.push("unsettle");
	else ids.push("settle", "snooze", task.pinned ? "unpin" : "pin");
	ids.push("edit", "relate");
	if (relationsOf(data, task.id).length) ids.push("unrelate");
	if (task.state !== "settled") ids.push(task.unread ? "mark-read" : "mark-unread");
	if (section === "pinned" || section === "inbox" || section === "working") ids.push("up", "down");
	ids.push("archive", "delete");
	return ids;
}

// ── tasks screen ────────────────────────────────────────────────────────

export const SECTIONS: (Section & { id: SectionId })[] = [
	{ id: "pinned", label: "Pinned", icon: "pin", empty: "Pin tasks to keep them on top", dropLabel: "Pin", dropIcon: "pin" },
	{ id: "inbox", label: "Inbox", icon: "inbox", empty: "Inbox zero", dropLabel: "Move to Inbox", dropIcon: "inbox" },
	{ id: "working", label: "Working", icon: "play", empty: "Not working on anything", dropLabel: "Start working", dropIcon: "play" },
	{ id: "snoozed", label: "Snoozed", icon: "alarm-clock", empty: "Nothing snoozed", order: false },
	{ id: "settled", label: "Settled", icon: "check", empty: "Nothing settled yet", collapsed: true, order: "fixed", dropLabel: "Settle", dropIcon: "check" },
];

function dueCell(task: Task, now: number): Cell {
	if (!task.due) return null;
	const overdue = isOverdue(task, now);
	return { text: formatDue(task.due), tone: overdue ? "danger" : undefined, icon: overdue ? "alarm-clock" : undefined };
}

/** The moment that matters for the task's section. */
function whenCell(task: Task): Cell {
	if (task.state === "snoozed" && task.snoozedUntil) return { text: "", at: task.snoozedUntil, icon: "alarm-clock" };
	if (task.state === "settled" && task.settledAt) return { text: "", at: task.settledAt, icon: "check" };
	const since = workingSince(task);
	if (since) return { text: "", at: since, icon: "play" };
	return { text: "", at: task.updated };
}

function taskRow(data: Data, task: Task, now: number): Row {
	const relations = relationsOf(data, task.id);
	const since = workingSince(task);
	const worked = timeSpent(task, now);
	const state: DetailItem[] = [
		{ section: "Task", label: "ID", value: `#${task.id}`, mono: true, copy: true },
		...(task.unread && task.unreadReason ? [{ section: "Task", label: "New", value: task.unreadReason, dot: "sky" as const }] : []),
		...(since ? [{ section: "Task", label: "Working since", value: new Date(since).toLocaleString() }] : []),
		...(task.snoozedUntil ? [{ section: "Task", label: "Snoozed until", value: new Date(task.snoozedUntil).toLocaleString() }] : []),
		...(task.settledAt ? [{ section: "Task", label: "Settled", value: new Date(task.settledAt).toLocaleString() }] : []),
		...(worked ? [{ section: "Task", label: "Time spent", value: `${spent(worked)} in ${task.sessions.length} session${task.sessions.length === 1 ? "" : "s"}` }] : []),
		{ section: "Task", label: "Due", value: task.due ? formatDue(task.due) : "No due date", tone: isOverdue(task, now) ? "danger" : undefined },
		{ section: "Task", label: "Created", value: new Date(task.created).toLocaleString() },
		{ section: "Task", label: "Last updated", value: new Date(task.updated).toLocaleString() },
	];
	const details: DetailItem[] = [
		...state,
		...data.labels
			.filter((l) => task.labels[l.id] !== undefined)
			.map((l): DetailItem => ({ section: "Labels", label: l.name, value: task.labels[l.id] === true ? "Yes" : String(task.labels[l.id]), dot: l.color })),
		...relations.map((r): DetailItem => ({ section: "Related tasks", label: r.label, value: taskName(data, r.task) })),
		...(task.desc.trim() ? [{ section: "Description", label: "Markdown", value: task.desc }] : []),
	];
	return {
		id: String(task.id),
		group: task.archived ? undefined : sectionOf(task),
		unread: task.unread || undefined,
		// The first cell titles the details drawer.
		cells: {
			name: {
				text: task.name,
				tags: tags(data, task),
				sub: task.unread && task.unreadReason ? task.unreadReason : snippet(task.desc),
				marks: task.pinned && task.state === "working" ? [{ icon: "play", tooltip: "Working on it", color: "sky" }] : undefined,
			},
			id: { text: `#${task.id}`, mono: true },
			due: dueCell(task, now),
			when: whenCell(task),
		},
		details,
		actions: actionsFor(data, task),
		targets: relations.length
			? { unrelate: relations.map((r) => ({ id: `${r.holder}:${r.type}:${r.inverse ? task.id : r.task}`, label: `${r.label} ${taskName(data, r.task)}`, icon: "link" })) }
			: undefined,
	};
}

export function tasksScreen(data: Data, view: View, now: number): Node {
	const s = search(view.query);
	const archived = view.show === "archived";
	const pool = data.tasks.filter((t) => t.archived === archived);
	const ordered = archived ? [...pool].sort((a, b) => b.updated - a.updated) : SECTIONS.flatMap((sec) => inSection(data, sec.id));
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
	const open = data.tasks.filter((t) => !t.archived && t.state !== "settled");
	const unread = open.filter((t) => t.unread).length;
	const summary = archived
		? `${shown.length} archived`
		: `${open.length} open${unread ? ` · ${unread} unread` : ""}${shown.length !== ordered.length ? ` · showing ${shown.length}` : ""}`;
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
					{ value: "active", label: "Tasks", icon: "list-checks" },
					{ value: "archived", label: "Archived", icon: "archive", tooltip: "Archived tasks, newest first" },
				],
			},
		],
		actions: [{ id: "new-task", label: "New task", icon: "plus", primary: true }],
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
				...(archived ? {} : { sections: SECTIONS, reorder: true }),
				selectEvents: true,
				rows: shown.map((t) => taskRow(data, t, now)),
				actions: taskActions(now),
				empty: archived
					? { title: "Nothing archived", description: "Archive tasks you want out of sight but not deleted.", icon: "archive" }
					: data.tasks.length
						? { title: "No matching tasks", description: "Change the search or filters.", icon: "search-x" }
						: { title: "No tasks yet", description: "Create one with New task.", icon: "list-checks" },
			},
		],
		dialog: view.dialog && ["task", "relate", "snooze"].includes(view.dialog.kind) ? dialogNode(data, view.dialog, now) : undefined,
	};
}

// ── labels screen ───────────────────────────────────────────────────────

export function labelsScreen(data: Data, view: View, now: number): Node {
	const uses = (label: Label) => data.tasks.filter((t) => t.labels[label.id] !== undefined).length;
	return {
		type: "page",
		summary: `${data.labels.length} labels · ${data.relationTypes.length} relation types`,
		actions: [
			{ id: "new-label", label: "New label", icon: "tag", primary: true },
			{ id: "new-relation-type", label: "New relation type", icon: "link" },
		],
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
							? { text: "", tags: label.values.map((v) => ({ text: v, color: label.color })), sub: label.freeform ? "suggestions" : undefined }
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
		dialog: view.dialog && ["label", "relationType"].includes(view.dialog.kind) ? dialogNode(data, view.dialog, now) : undefined,
	};
}

// ── dialogs ─────────────────────────────────────────────────────────────

/** Labels as the pill editor's keys: yes/no labels are flags, lookups pick from their values. */
export function tagKeys(data: Data): TagKey[] {
	return data.labels.map((l) => ({
		key: String(l.id),
		label: l.name,
		color: l.color,
		...(l.type === "bool" ? { flag: true } : { values: l.values, freeform: l.freeform }),
	}));
}

export const toTagValues = (labels: Task["labels"]): TagValue[] =>
	Object.entries(labels).map(([key, value]) => (value === true ? { key } : { key, value: String(value) }));

export const fromTagValues = (values: TagValue[]): Task["labels"] => Object.fromEntries(values.map((v) => [v.key, v.value === undefined ? true : v.value]));

export const fieldValue = (value: unknown) => (value === NONE ? "" : value);

const save: Action = { id: "save", label: "Save", primary: true };
const error = (text?: string): Node[] => (text ? [{ type: "text", text, tone: "danger" }] : []);

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
							{ type: "datetime", id: "due", label: "Due", value: d.due, description: "Time is optional." },
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
				description: `It comes back to the top of the Inbox, marked unread. ${choices.map((c) => c.label).join(", ")} are also in the Snooze menu.`,
				actions: [{ ...save, label: "Snooze", disabled: !dialog.until }],
				children: [
					...error(dialog.error),
					{ type: "form", id: "snooze", fields: [{ type: "datetime", id: "until", label: "Until", value: dialog.until, description: "A date alone means 9:00 that day." }] },
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
									] satisfies Field[])
								: []),
						],
					},
				],
			};
		}
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

// ── quick view ──────────────────────────────────────────────────────────

/**
 * The menu-bar focus list: what you're working on, then Pinned and the Inbox in your order.
 * Unread tasks are bold; overdue ones get a red dot. Enter opens the task in the main window.
 */
export function quickView(data: Data, now: number): Node {
	const working = inSection(data, "working");
	const pinnedWorking = inSection(data, "pinned").filter((t) => t.state === "working");
	const waiting = [...inSection(data, "pinned").filter((t) => t.state !== "working"), ...inSection(data, "inbox")];
	const item = (t: Task) => {
		const since = workingSince(t);
		const labels = tags(data, t).map((tag) => tag.text).join(" · ");
		const subtitle = since ? [`Working · ${spent(now - since)}`, labels].filter(Boolean).join(" · ") : (t.unread && t.unreadReason) || labels || undefined;
		return {
			id: String(t.id),
			title: t.name,
			subtitle,
			icon: since ? "play" : t.pinned ? "pin" : undefined,
			dot: isOverdue(t, now) ? ("danger" as const) : since ? { color: "sky" as const, pulse: true, label: "Working" } : undefined,
			...(t.due ? { metaAt: dueAt(t.due) } : {}),
			unread: t.unread || undefined,
			actions: since
				? [{ id: "done", label: "Done for now", icon: "inbox", key: "d" }, { id: "settle", label: "Settle", icon: "check", key: "s" }]
				: [{ id: "start", label: "Start working on this", icon: "play", key: "w" }, { id: "settle", label: "Settle", icon: "check", key: "s" }],
		};
	};
	return {
		type: "list",
		id: "focus",
		items: [...pinnedWorking, ...working, ...waiting].slice(0, 15).map(item),
		empty: { title: "Inbox zero", description: "Nothing waiting for you.", icon: "inbox" },
	};
}
