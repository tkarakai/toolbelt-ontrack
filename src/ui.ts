// Builds OnTrack's surfaces from the data and the plugin's view state. Pure: given the same
// state and clock it returns the same trees, which the tests rely on.
import { HUES, search, type Action, type Cell, type DetailItem, type Dialog as DialogNode, type Field, type Filter, type Node, type Row, type Tag } from "@toolbelt/sdk";
import { dueAt, formatDue, relationsOf, type Data, type Label, type LabelInput, type Task, type TaskInput } from "./model";

export type Dialog =
	| { kind: "task"; id?: number; draft: TaskInput; error?: string }
	| { kind: "relate"; from: number; type: string; to: string; error?: string }
	| { kind: "label"; id?: number; draft: Omit<LabelInput, "values"> & { values: string }; error?: string }
	| { kind: "relationType"; id?: string; name: string; inverse: string; error?: string };

export type View = {
	query: string;
	/** Filter id → selected option values. */
	filters: Record<string, string[]>;
	sort: { key: string; desc: boolean };
	show: "open" | "all";
	dialog?: Dialog;
};

export const initialView = (): View => ({ query: "", filters: {}, sort: { key: "due", desc: false }, show: "open" });

const NONE = "__none";

// ── shared helpers ──────────────────────────────────────────────────────

/** A task is done when its Status label says Done. */
export function isDone(data: Data, task: Task) {
	const status = data.labels.find((l) => l.name.toLowerCase() === "status");
	const value = status && task.labels[status.id];
	return typeof value === "string" && value.toLowerCase() === "done";
}

/** The task's labels as colored pills, in label order. Bool labels show their name. */
export function tags(data: Data, task: Task): Tag[] {
	return data.labels.flatMap((label) => {
		const value = task.labels[label.id];
		if (value === undefined) return [];
		return [{ text: value === true ? label.name : String(value), color: label.color, tooltip: value === true ? undefined : label.name }];
	});
}

const optionValue = (value: string | boolean) => (value === true ? "yes" : String(value));

function filterOptions(data: Data, label: Label): string[] {
	if (label.type === "bool") return ["yes"];
	const used = data.tasks.map((t) => t.labels[label.id]).filter((v): v is string => typeof v === "string");
	return [...new Set([...label.values, ...used.sort()])];
}

function visibleTasks(data: Data, view: View) {
	const s = search(view.query);
	const tasks = data.tasks.filter((task) => {
		if (view.show === "open" && isDone(data, task)) return false;
		for (const [id, values] of Object.entries(view.filters)) {
			if (!values.length) continue;
			const value = task.labels[id.slice("label:".length)];
			if (value === undefined || !values.includes(optionValue(value))) return false;
		}
		return s.test([`#${task.id}`, task.name, task.desc, ...tags(data, task).map((t) => t.text)]);
	});
	const { key, desc } = view.sort;
	const value = (t: Task): number | string =>
		key === "name" ? t.name.toLowerCase() : key === "due" ? (t.due ? dueAt(t.due) : Number.POSITIVE_INFINITY) : key === "updated" ? t.updated : t.id;
	tasks.sort((a, b) => {
		const [x, y] = [value(a), value(b)];
		const order = x < y ? -1 : x > y ? 1 : a.id - b.id;
		return desc ? -order : order;
	});
	return { tasks, highlight: s.highlight() };
}

const name = (data: Data, id: number) => {
	const task = data.tasks.find((t) => t.id === id);
	return task ? `#${id} ${task.name}` : `#${id}`;
};

// ── tasks screen ────────────────────────────────────────────────────────

const TASK_ACTIONS: Action[] = [
	{ id: "edit", label: "Edit", icon: "pencil", key: "e", inline: true, group: "edit" },
	{ id: "relate", label: "Relate to…", icon: "link", key: "r", group: "edit" },
	{ id: "unrelate", label: "Remove relation", icon: "unlink", group: "edit" },
	{ id: "delete", label: "Delete", icon: "trash-2", tone: "destructive", confirm: "Delete this task and its relations?", group: "delete" },
];

/** The description's first line as plain text. */
export const snippet = (markdown: string) =>
	markdown
		.split("\n")
		.find((l) => l.trim())
		?.replace(/^\s*(?:#+|>|[-*+]|\d+\.)\s+/, "")
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/[*_`~]/g, "")
		.trim() || undefined;

function dueCell(data: Data, task: Task, now: number): Cell {
	if (!task.due) return null;
	const overdue = dueAt(task.due) < now && !isDone(data, task);
	return { text: formatDue(task.due), tone: overdue ? "danger" : undefined, icon: overdue ? "alarm-clock" : undefined };
}

function taskRow(data: Data, task: Task, now: number): Row {
	const relations = relationsOf(data, task.id);
	const details: DetailItem[] = [
		{ section: "Task", label: "ID", value: `#${task.id}`, mono: true, copy: true },
		{ section: "Task", label: "Created", value: new Date(task.created).toLocaleString() },
		{ section: "Task", label: "Last updated", value: new Date(task.updated).toLocaleString() },
		{ section: "Task", label: "Due", value: task.due ? formatDue(task.due) : "No due date" },
		...data.labels
			.filter((l) => task.labels[l.id] !== undefined)
			.map((l): DetailItem => ({ section: "Labels", label: l.name, value: task.labels[l.id] === true ? "Yes" : String(task.labels[l.id]), dot: l.color })),
		...relations.map((r): DetailItem => ({ section: "Related tasks", label: r.label, value: name(data, r.task) })),
		...(task.desc.trim() ? [{ section: "Description", label: "Markdown", value: task.desc }] : []),
	];
	return {
		id: String(task.id),
		cells: {
			id: { text: `#${task.id}`, mono: true },
			name: { text: task.name, tags: tags(data, task), sub: snippet(task.desc) },
			due: dueCell(data, task, now),
			updated: { text: "", at: task.updated },
		},
		details,
		actions: TASK_ACTIONS.filter((a) => a.id !== "unrelate" || relations.length).map((a) => a.id),
		targets: relations.length
			? { unrelate: relations.map((r) => ({ id: `${r.holder}:${r.type}:${r.inverse ? task.id : r.task}`, label: `${r.label} ${name(data, r.task)}`, icon: "link" })) }
			: undefined,
	};
}

export function tasksScreen(data: Data, view: View, now: number): Node {
	const { tasks, highlight } = visibleTasks(data, view);
	const filters: Filter[] = data.labels.map((label) => {
		const counts = new Map<string, number>();
		for (const t of data.tasks) {
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
	const open = data.tasks.filter((t) => !isDone(data, t)).length;
	return {
		type: "page",
		search: { placeholder: "Search tasks" },
		summary: `${tasks.length} of ${data.tasks.length} task${data.tasks.length === 1 ? "" : "s"} · ${open} open`,
		highlight,
		filters,
		controls: [
			{
				type: "segmented",
				id: "show",
				label: "Show",
				value: view.show,
				options: [
					{ value: "open", label: "Open", tooltip: "Hide tasks whose Status is Done" },
					{ value: "all", label: "All" },
				],
			},
		],
		actions: [{ id: "new-task", label: "New task", icon: "plus", primary: true }],
		children: [
			{
				type: "table",
				id: "tasks",
				columns: [
					{ key: "id", title: "#", mono: true, width: 64, sortable: true, sortDesc: true },
					{ key: "name", title: "Task", grow: true, sortable: true },
					{ key: "due", title: "Due", width: 176, sortable: true, priority: 2 },
					{ key: "updated", title: "Updated", width: 110, sortable: true, sortDesc: true, priority: 3 },
				],
				rows: tasks.map((t) => taskRow(data, t, now)),
				actions: TASK_ACTIONS,
				sort: view.sort,
				empty: data.tasks.length
					? { title: "No matching tasks", description: "Change the search or filters.", icon: "search-x" }
					: { title: "No tasks yet", description: "Create one with New task.", icon: "list-checks" },
			},
		],
		dialog: view.dialog?.kind === "task" || view.dialog?.kind === "relate" ? dialogNode(data, view.dialog) : undefined,
	};
}

// ── labels screen ───────────────────────────────────────────────────────

export function labelsScreen(data: Data, view: View): Node {
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
						name: { text: label.name, tags: [{ text: label.color, color: label.color }] },
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
						name: { text: t.name, sub: t.id, mono: false },
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
		dialog: view.dialog?.kind === "label" || view.dialog?.kind === "relationType" ? dialogNode(data, view.dialog) : undefined,
	};
}

// ── dialogs ─────────────────────────────────────────────────────────────

function labelField(label: Label, value: string | boolean | undefined): Field {
	const id = `label:${label.id}`;
	if (label.type === "bool") return { type: "switch", id, label: label.name, value: value === true };
	if (label.freeform)
		return {
			type: "text",
			id,
			label: label.name,
			value: typeof value === "string" ? value : "",
			placeholder: label.values.length ? label.values.join(", ") : "Any text",
		};
	return {
		type: "select",
		id,
		label: label.name,
		value: typeof value === "string" ? value : NONE,
		options: [{ value: NONE, label: "—" }, ...label.values.map((v) => ({ value: v, label: v }))],
	};
}

export const fieldValue = (value: unknown) => (value === NONE ? "" : value);

const save: Action = { id: "save", label: "Save", primary: true };
const error = (text?: string): Node[] => (text ? [{ type: "text", text, tone: "danger" }] : []);

function dialogNode(data: Data, dialog?: Dialog): DialogNode | undefined {
	if (!dialog) return undefined;
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
							{ type: "text", id: "due", label: "Due", value: d.due, placeholder: "2026-11-20 or 2026-11-20 14:30", description: "Time is optional." },
							{ type: "text", id: "desc", label: "Description", value: d.desc, placeholder: "Markdown", description: "Markdown; previewed below." },
							...data.labels.map((l) => labelField(l, d.labels[l.id])),
						],
					},
					...(d.desc.trim() ? [{ type: "card", title: "Description preview", children: [{ type: "markdown", text: d.desc }] } satisfies Node] : []),
				],
			};
		}
		case "relate": {
			const others = data.tasks.filter((t) => t.id !== dialog.from);
			return {
				id: "relate",
				title: `Relate ${name(data, dialog.from)}`,
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
								label: "Relation", description: "As it will read on this task: Parent, Child, Blocked by…",
								value: dialog.type,
								options: data.relationTypes.flatMap((t) =>
									t.inverse === t.name ? [{ value: t.id, label: t.name }] : [{ value: t.id, label: t.name }, { value: `~${t.id}`, label: t.inverse }],
								),
							},
							{
								type: "select",
								id: "to",
								label: "Task",
								value: dialog.to || NONE,
								options: [{ value: NONE, label: others.length ? "Choose a task" : "No other tasks" }, ...others.map((t) => ({ value: String(t.id), label: name(data, t.id) }))],
							},
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
							{ type: "select", id: "color", label: "Color", value: d.color, options: HUES.map((h) => ({ value: h, label: h[0]!.toUpperCase() + h.slice(1) })) },
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

/** Open tasks with a due date, soonest first; the overdue ones are red. */
export function quickView(data: Data, now: number): Node {
	const due = data.tasks
		.filter((t) => t.due && !isDone(data, t))
		.sort((a, b) => dueAt(a.due!) - dueAt(b.due!))
		.slice(0, 12);
	return {
		type: "list",
		id: "due",
		items: due.map((t) => {
			const at = dueAt(t.due!);
			return {
				id: String(t.id),
				title: t.name,
				subtitle: tags(data, t).map((tag) => tag.text).join(" · ") || undefined,
				dot: at < now ? "danger" : at - now < 86_400_000 ? "warning" : "muted",
				metaAt: at,
			};
		}),
		empty: { title: "Nothing due", description: "Open tasks with a due date show here.", icon: "calendar-check" },
	};
}

export const overdue = (data: Data, now: number) => data.tasks.filter((t) => t.due && dueAt(t.due) < now && !isDone(data, t)).length;
