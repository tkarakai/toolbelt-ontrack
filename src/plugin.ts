// Connects the SDK to the model: events change the data or open dialogs, every data change is
// saved immediately, and the open surfaces re-render. The search, filters, grouping and Subtasks
// choice are the SDK's view, one per viewer (Toolbelt saves the person's); each instance has its
// own dialog, so an agent's drafts never touch the person's. In active mode a timer wakes snoozed
// tasks, brings watched tasks back for their check-ins, announces due dates, stalls tasks left
// untouched and reminds you of stalled ones; probe mode starts no timers.
import { HUES, PERSON, type Context, type EventInfo, type Hue, type PluginDefinition, type TagValue, type View as SdkView } from "@toolbelt/sdk";
import { ACTIONS, FORMS } from "./declarations";
import * as display from "./display";
import * as life from "./lifecycle";
import * as model from "./model";
import { InvalidInput, type Data } from "./model";
import { applyValues, attention, fieldValue, fromTagValues, labelDraft, labelInput, newTaskStart, quickView, relatedEntries, relatedId, REPEATS, setRepeat, settingsScreen, snoozeDialog, tasksScreen, updateDraft, watchDialog, type Dialog, type View } from "./ui";

export type Options = { load(): Data; save(data: Data): void; now?: () => number; readAfterMs?: number };

/** Each move's action id and the state it moves the task to (see `actionFor` in ui.ts). */
const MOVES: Record<string, model.TaskState> = {
	work: "working",
	done: "inbox",
	wake: "inbox",
	unwatch: "inbox",
	reopen: "inbox",
	unsettle: "inbox",
	unstall: "inbox",
	stall: "stalled",
	resume: "working",
	snooze: "snoozed",
	watch: "watching",
	settle: "settled",
};

/** How long an Undo stays offered: as long as Toolbelt shows a toast with a button. */
export const UNDO_MS = 8_000;
/**
 * How long a task stays selected before it counts as read. Toolbelt sends `select` once the
 * selection has rested 400 ms, so a task reads about two seconds after you land on it.
 */
export const READ_AFTER_MS = 1_600;
/** The longest wait between checks, so a sleeping Mac catches up soon after waking. */
const TICK_MS = 60_000;

export function ontrack({ load, save, now = Date.now, readAfterMs = READ_AFTER_MS }: Options): PluginDefinition {
	let data: Data = model.seed();
	let loaded = false;
	/**
	 * Loads the data file once. The view declarations come from it and are read at the handshake,
	 * before `start`, so whichever comes first loads it.
	 */
	const loadOnce = () => {
		if (!loaded) {
			data = load();
			// The view declarations come from the stored row, which follows the labels.
			data.filters = display.normalizeFilters(data);
			loaded = true;
		}
		return data;
	};
	/**
	 * Each instance's open dialog: every person's screen shares `PERSON`'s; an agent acting on a
	 * screen fills dialogs in an instance of its own, which closes with it.
	 */
	const dialogs = new Map<string, Dialog>();
	/** The view declarations last sent, to send them again only when they change. */
	let declared = "";
	/**
	 * The latest change's Undo: the data before it, until when, and the token its toast carries.
	 * Only that toast can use it, and any later change (but opening a task) withdraws it, so Undo
	 * never reverts the wrong change or discards work done since.
	 */
	let undo: { data: Data; until: number; token: number } | undefined;
	let undoToken = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;
	/** Marks the selected task read once it has stayed selected; a new selection cancels it. */
	let reading: ReturnType<typeof setTimeout> | undefined;
	let readingId: number | undefined;
	let context: Context | undefined;
	/** What the event being handled returns to whoever sent it (`{ data }`), such as a created task's id. */
	let answer: Record<string, unknown> | undefined;
	/** The event being handled names nothing OnTrack does (not handled). */
	let unknown = false;
	/** The day the list was last drawn for: due groups move on at midnight. */
	let drawnDay = new Date(now()).toDateString();

	const badge = (c: Context) => c.badge(attention(data, now()) || null);

	/** Saves, updates the badge and re-renders after a change that came from the clock. */
	function onTime() {
		if (life.tick(data, now()) && context) {
			undo = undefined;
			save(data);
			badge(context);
			context.invalidate();
		} else if (context && new Date(now()).toDateString() !== drawnDay) context.invalidate();
		drawnDay = new Date(now()).toDateString();
		schedule();
	}
	/**
	 * Marks a task read once it has stayed selected. Opening a task only marks it read, so a
	 * standing Undo keeps it read too instead of being withdrawn.
	 */
	function markReadLater(id: number) {
		clearTimeout(reading);
		readingId = id;
		reading = setTimeout(() => {
			readingId = undefined;
			const task = data.tasks.find((x) => x.id === id);
			if (!task?.unread || !context) return;
			life.markRead(task);
			const opened = undo?.data.tasks.find((x) => x.id === id);
			if (opened) life.markRead(opened);
			save(data);
			badge(context);
			context.invalidate();
		}, readAfterMs);
	}
	function schedule() {
		if (!context || context.mode !== "active") return;
		clearTimeout(timer);
		const next = life.nextWake(data, now());
		timer = setTimeout(onTime, Math.max(1_000, Math.min(TICK_MS, (next ?? Infinity) - now())));
	}

	/** "next check-in Mon, Dec 1, 9:00 AM", or "no reminders": where a watched task stands. */
	const nextCheckIn = (id: number) => {
		const next = model.findTask(data, id).watch?.next;
		return next === undefined ? "no reminders" : `next check-in ${new Date(next).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;
	};

	/** Offers Undo for a change that's easy to make by accident. */
	function offerUndo(c: Context, text: string, before: Data) {
		undo = { data: before, until: now() + UNDO_MS, token: ++undoToken };
		c.toast(text, "default", { id: "undo", label: "Undo", key: "cmd+z", payload: { token: undo.token } });
	}

	/** What a move offers to undo, by where the task went. */
	const moved = (id: number, to: model.TaskState) =>
		to === "working" ? `Working on #${id}` : to === "inbox" ? `#${id} back in the Inbox` : to === "settled" ? `Settled #${id}` : to === "stalled" ? `#${id} is stalled` : `Moved #${id}`;

	/** The update box for a stalled task's next step: saving it brings the task back to Working on. */
	const nextStep = (task: model.Task) => ({ kind: "updates" as const, id: task.id, draft: "", resume: true });

	/**
	 * Moves a task to `to`, the way every entry point does (keys, drags, the drawer's Status, the
	 * quick view): Snoozed and Watching open their dialog to pick the time, and a stalled task
	 * going back to Working on opens the update box for its next step; any other state is a
	 * `transition` now. Refused moves throw before anything opens. Returns whether data changed.
	 */
	function moveTo(task: model.Task, to: model.TaskState, c: Context, surface: string, instance: string, before: Data, at: number | null = null): boolean {
		const t = now();
		const refused = to === task.state && (to === "snoozed" || to === "watching") ? undefined : life.refusal(task, to);
		if (refused) throw new InvalidInput(refused);
		if (to === "stalled" && !data.stall.on) throw new InvalidInput("Stalling is off in Settings.");
		const resume = to === "working" && task.state === "stalled";
		if (to === "snoozed" || to === "watching" || resume) {
			dialogs.set(instance, resume ? nextStep(task) : to === "snoozed" ? snoozeDialog(task, t) : watchDialog(task, t));
			// From the quick view, the dialog opens in the main window, on the task.
			if (surface === "quick" && !c.navigate("tasks", { select: String(task.id) })) {
				dialogs.delete(instance);
				throw new InvalidInput("Open OnTrack to choose when.");
			}
			return false;
		}
		life.transition(data, task.id, to, { before: at }, t);
		offerUndo(c, moved(task.id, to), before);
		return true;
	}

	/**
	 * A drag into a group: the drop means every value along the group's path. Labels and the due
	 * date change first; then Archived archives (out of it unarchives), and a state is that move,
	 * like its key (`moveTo`, so Snoozed and Watching open their dialog). Within the task's own
	 * Inbox or Working on the drop reorders. One Undo covers it all.
	 */
	function dropInto(task: model.Task, section: string, at: number | null, c: Context, surface: string, instance: string, before: Data): boolean {
		const t = now();
		const target = display.dropTarget(section);
		if (!target.size) throw new InvalidInput("Group the list to move tasks by dragging.");
		const labels = { ...task.labels };
		let due = task.due ?? "";
		let edited = false;
		for (const [id, value] of target) {
			if (id === display.STATUS || value === display.valueOf(data, id, task, t)) continue;
			if (id === display.DUE) {
				if (value === "today") {
					const d = new Date(t);
					const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
					due = due.includes("T") ? `${day}${due.slice(10)}` : day;
				} else if (value === "none") due = "";
				else throw new InvalidInput("Set its due date in the details to move it there.");
			} else {
				const label = data.labels.find((l) => display.labelFilterId(l) === id);
				if (!label) throw new InvalidInput("That label no longer exists.");
				if (value === display.NO_VALUE) delete labels[label.id];
				else labels[label.id] = label.type === "bool" ? true : value;
			}
			edited = true;
		}
		if (edited) model.updateTask(data, task.id, { name: task.name, due, desc: task.desc, labels }, t);
		const wasArchived = task.archived;
		const status = target.get(display.STATUS);
		if (status === "archived") {
			if (!wasArchived) life.archive(data, task.id, t);
			if (!wasArchived || edited) offerUndo(c, wasArchived ? `Moved #${task.id}` : `Archived #${task.id}`, before);
			return !wasArchived || edited;
		}
		const to = status === undefined ? undefined : display.stateOf(status);
		// Out of Archived into a state: unarchived first, then that move.
		if (wasArchived && to) life.unarchive(data, task.id, t);
		const place = to === "inbox" || to === "working" ? at : null;
		if (!to || to === task.state) {
			// Its own state: a drop reorders Inbox and Working on.
			if (to) life.drop(data, task.id, to, place, t);
			if (edited || (wasArchived && to)) offerUndo(c, wasArchived && to ? `Unarchived #${task.id}` : `Moved #${task.id}`, before);
			return true;
		}
		return moveTo(task, to, c, surface, instance, before, place) || edited || wasArchived;
	}

	/**
	 * A field of the drawer's property sheet. Status moves the task (`moveTo`); the rest saves
	 * through the same checks as the Edit dialog.
	 */
	function editInPlace(task: model.Task, field: string, value: unknown, c: Context, instance: string, before: Data): boolean {
		const t = now();
		if (field === "state") {
			const to = String(value) as model.TaskState;
			if (to === task.state || !life.STATES.includes(to)) return false;
			return moveTo(task, to, c, "screen:tasks", instance, before);
		}
		const input = { name: task.name, due: task.due ?? "", desc: task.desc, labels: { ...task.labels } };
		if (field === "related") return editRelations(task, Array.isArray(value) ? (value as TagValue[]) : [], c, before);
if (field === "labels") input.labels = fromTagValues(Array.isArray(value) ? value : []);
		else if (field === "name" || field === "due" || field === "desc") input[field] = String(value);
		else return false;
		model.updateTask(data, task.id, input, t);
		return true;
	}

	/**
	 * The drawer's Related field changed: relations it no longer shows are removed, and those
	 * it newly shows are made (a new Parent replaces the old one). One Undo covers it.
	 */
	function editRelations(task: model.Task, next: TagValue[], c: Context, before: Data): boolean {
		const t = now();
		const current = relatedEntries(data, task.id);
		const same = (a: TagValue, b: TagValue) => a.key === b.key && relatedId(a.value) === relatedId(b.value);
		const removed = current.filter((e) => !next.some((n) => same(n, e.value)));
		const added = next.filter((n) => typeof n?.key === "string" && !current.some((e) => same(n, e.value)));
		for (const { relation: r } of removed) model.unrelate(data, r.holder, r.type, r.inverse ? task.id : r.task, t);
		for (const n of added) {
			const to = relatedId(n.value);
			if (to === undefined) throw new InvalidInput("Choose a task.");
			model.relate(data, task.id, n.key.replace(/^~/, ""), to, n.key.startsWith("~"), t);
		}
		if (!removed.length && !added.length) return false;
		offerUndo(c, `Changed the relations of #${task.id}`, before);
		return true;
	}

	/** Every row id of the Tasks table, nested rows included. */
	function rowIds(screen: any): string[] {
		const table = (screen?.children ?? []).find((n: any) => n?.type === "table" && n.id === "tasks");
		const walk = (rows: any[]): string[] => rows.flatMap((r) => [r.id, ...walk(r.children ?? [])]);
		return walk(table?.rows ?? []);
	}

	/** The row a task has in a view of the Tasks list, if it shows there. */
	function shownRow(v: SdkView, id: number, t: number): string | undefined {
		const shown = rowIds(tasksScreen(data, v, t));
		return shown.find((r) => r === String(id)) ?? shown.find((r) => r.startsWith(`c${id}@`));
	}

	/** What a screen renders with: the instance's view and its dialog. */
	const screenView = (v: SdkView): View => {
		const subtasks = v.controls.subtasks as model.SubtaskMode | undefined;
		const dialog = dialogs.get(v.instance);
		return { search: v.search, filters: v.filters, arrange: v.arrange, ...(subtasks && model.SUBTASK_MODES.includes(subtasks) && { subtasks }), ...(dialog && { dialog }) };
	};

	/** Saves and updates after a change the clock made since the last look. */
	function catchUp(c: Context) {
		if (!life.tick(data, now())) return;
		undo = undefined;
		save(data);
		badge(c);
		schedule();
		c.invalidate();
	}

	/** The view declarations follow the labels (a filter each, with their values): sent again when they change. */
	function redeclare(c: Context) {
		if (JSON.stringify(display.viewDeclaration(data)) !== declared) c.declare();
	}

	/**
	 * Handles an event from `ev.instance`, whose dialog it works on. Returns true when the data
	 * changed; sets `answer` for what the sender gets back and `unknown` when it names nothing.
	 */
	function onEvent(surface: string, name: string, p: any, c: Context, before: Data, ev: EventInfo): boolean {
		const { instance } = ev;
		const dialog = dialogs.get(instance);
		const setDialog = (next: Dialog | undefined) => (next ? dialogs.set(instance, next) : dialogs.delete(instance));
		const rowId = () => Number(String(p?.rowId ?? "").replace(/^[lr]/, ""));
		const t = now();
		const name2 = (id: number) => `#${id}`;
		/** The task and update an update action is about: from the timeline or a drawer item. */
		const updateRef = () => {
			const taskId = p?.timeline && dialog?.kind === "updates" ? dialog.id : rowId();
			const task = model.findTask(data, taskId);
			return { task, update: model.findUpdate(task, Number(p?.entryId ?? p?.target)) };
		};
		if (name.startsWith("snooze:")) {
			const choice = life.snoozeChoices(t).find((x) => `snooze:${x.id}` === name);
			if (!choice) throw new InvalidInput("That snooze time has passed.");
			life.transition(data, rowId(), "snoozed", { until: choice.until }, t);
			offerUndo(c, `Snoozed ${name2(rowId())} until ${new Date(choice.until).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}`, before);
			return true;
		}
		switch (name) {
			// The search and filter row are the SDK's view (`views`): their events never come here.
			case "dialog-close":
				setDialog(undefined);
				return false;
			case "select": {
				// Opening a task marks it read once it has stayed open a moment, for the person only:
				// an agent looking at a task hasn't read it for them.
				if (ev.origin !== "person") return false;
				clearTimeout(reading);
				readingId = undefined;
				const task = p?.rowId ? data.tasks.find((x) => x.id === rowId()) : undefined;
				if (task?.unread) markReadLater(task.id);
				return false;
			}
			case "reorder": {
				// Onto a task: it becomes that task's subtask.
				if (p?.onto !== undefined && p.onto !== null) {
					const parent = Number(p.onto);
					model.setParent(data, rowId(), parent, t);
					offerUndo(c, `#${rowId()} is now a subtask of #${parent}`, before);
					return true;
				}
				return dropInto(model.findTask(data, rowId()), String(p?.section ?? ""), p?.before ? Number(p.before) : null, c, surface, instance, before);
			}
			// ⌥→ goes under the task above; ⌥← moves out to the parent's parent.
			case "indent": {
				const under = Number(p?.target);
				if (!Number.isInteger(under)) throw new InvalidInput("There's no task above to go under.");
				model.setParent(data, rowId(), under, t);
				offerUndo(c, `#${rowId()} is now a subtask of #${under}`, before);
				return true;
			}
			case "outdent": {
				const parent = model.parentOf(data, rowId());
				if (parent === undefined) throw new InvalidInput("It's not a subtask.");
				model.setParent(data, rowId(), model.parentOf(data, parent) ?? null, t);
				offerUndo(c, `Moved #${rowId()} out a level`, before);
				return true;
			}
			case "undo":
				if (!undo || undo.until < t || p?.token !== undo.token) throw new InvalidInput(undo && undo.until >= t ? "Only the latest change can be undone." : "Too late to undo.");
				data = undo.data;
				undo = undefined;
				return true;
			case "field": {
				const value = fieldValue(p?.value);
				// The details drawer edits the task in place: each field saves on its own.
				if (p?.form === "task" && p?.rowId !== undefined) return editInPlace(model.findTask(data, rowId()), String(p.field), value, c, instance, before);
				// Settings' Stalling card: each setting saves on its own.
				if (p?.form === "stall") {
					model.setStall(data, { [String(p.field)]: value });
					return true;
				}
				// Dialog drafts: only this instance's dialog, nothing saved until its Save.
				if (dialog?.kind === "task" && p?.form === "task-draft") {
					if (p.field === "labels") dialog.draft.labels = fromTagValues(Array.isArray(value) ? value : []);
else if (p.field === "state" && life.STATES.includes(value as model.TaskState)) dialog.start = { ...(dialog.start ?? newTaskStart()), state: value as model.TaskState };
else if (p.field === "related") dialog.start = { ...(dialog.start ?? newTaskStart()), related: Array.isArray(value) ? (value as TagValue[]).filter((v) => typeof v?.key === "string") : [] };
					else if (p.field === "name" || p.field === "due" || p.field === "desc") dialog.draft[p.field as "name"] = String(value);
				} else if (dialog?.kind === "relate" && p?.form === "relate") {
					if (p.field === "type") dialog.type = String(value);
					if (p.field === "to") dialog.to = String(value);
				} else if (dialog?.kind === "snooze" && p?.form === "snooze") {
					dialog.until = String(value);
				} else if (dialog?.kind === "watch" && p?.form === "watch") {
					if (p.field === "on") dialog.on = String(value);
					if (p.field === "repeat") setRepeat(dialog, String(value), t);
					if (p.field === "next") (dialog.next = String(value)), (dialog.nextSet = true);
					if (p.field === "note") dialog.note = String(value);
				} else if (dialog?.kind === "label" && typeof p?.form === "string" && p.form.startsWith("label")) {
					const d = dialog.draft;
					if (p.field === "name" || p.field === "shades") d[p.field as "name"] = String(value);
					if (p.field === "color" && (HUES as readonly unknown[]).includes(value)) d.color = value as Hue;
					if (p.field === "type") d.type = value === "bool" ? "bool" : "string";
					if (p.field === "freeform") d.freeform = value === true;
					if (p.field === "valueColors") d.valueColors = value === "each";
					if (p.field === "values") applyValues(d, value);
				} else if (dialog?.kind === "relationType" && p?.form === "relationType") {
					if (p.field === "name" || p.field === "inverse") dialog[p.field as "name"] = String(value);
				} else if (dialog?.kind === "updates" && p?.form === "update-new") {
					dialog.draft = String(value);
				} else if (dialog?.kind === "updates" && dialog.editing && p?.form === "update-edit") {
					const field = String(p.field);
					if (field.startsWith("edit-text")) dialog.editing.text = String(value);
					if (field === "edit-added") dialog.editing.added = String(value);
					if (field === "edit-updated") dialog.editing.updated = String(value);
				} else unknown = true;
				return false;
			}
			// ── the state machine: each move's action, through `moveTo` ──
			case "work":
			case "stall":
			case "unstall":
			case "resume":
			case "done":
			case "wake":
			case "unwatch":
			case "reopen":
			case "snooze":
			case "watch":
			case "settle":
			case "unsettle":
				return moveTo(model.findTask(data, rowId()), MOVES[name]!, c, surface, instance, before);
			case "archive":
				life.archive(data, rowId(), t);
				offerUndo(c, `Archived ${name2(rowId())}`, before);
				return true;
			case "unarchive":
				life.unarchive(data, rowId(), t);
				return true;
			case "mark-unread":
				life.markUnread(model.findTask(data, rowId()), "Marked unread");
				return true;
			case "mark-read":
				life.markRead(model.findTask(data, rowId()));
				return true;
			case "up":
			case "down":
				return life.move(data, rowId(), name === "up" ? -1 : 1, t);
			// ── editing ──
			case "new-task":
				setDialog({ kind: "task", draft: { name: "", due: "", desc: "", labels: {} }, start: newTaskStart() });
				return false;
			case "edit": {
				const task = model.findTask(data, rowId());
				setDialog({ kind: "task", id: task.id, draft: { name: task.name, due: task.due ?? "", desc: task.desc, labels: { ...task.labels } } });
				return false;
			}
			// ── updates ──
			case "add-update":
				// Written in the drawer's composer or the quick view; otherwise the Updates dialog.
				if (typeof p?.text === "string") {
					answer = { task: rowId(), update: model.addUpdate(data, rowId(), p.text, t).id };
					return true;
				}
				{
					// On a stalled task, the update is its next step.
					const task = model.findTask(data, rowId());
					setDialog(task.state === "stalled" && !task.archived ? nextStep(task) : { kind: "updates", id: task.id, draft: "" });
				}
				return false;
			case "edit-update-text": {
				const { task, update } = updateRef();
				model.editUpdate(data, task.id, update.id, { text: String(p?.text ?? "") }, t);
				return true;
			}
			case "quick-task": {
				const task = model.addTask(data, { name: String(p?.text ?? ""), due: "", desc: "", labels: {} }, t);
				c.toast(`Added #${task.id} to the Inbox`, "success");
				answer = { task: task.id };
				return true;
			}
			case "edit-update": {
				const { task, update } = updateRef();
				const fromDrawer = !(dialog?.kind === "updates" && dialog.id === task.id);
				setDialog({ kind: "updates", id: task.id, draft: dialog?.kind === "updates" ? dialog.draft : "", editing: updateDraft(update, fromDrawer) });
				return false;
			}
			case "update-back":
				if (dialog?.kind !== "updates") return (unknown = true), false;
				setDialog(dialog.editing?.closeAfter ? undefined : { kind: "updates", id: dialog.id, draft: dialog.draft });
				return false;
			case "delete-update": {
				const { task, update } = updateRef();
				model.deleteUpdate(data, task.id, update.id, t);
				// Deleting the update being edited goes back to the list.
				if (dialog?.kind === "updates" && dialog.editing?.update === update.id) setDialog({ kind: "updates", id: dialog.id, draft: dialog.draft });
				offerUndo(c, `Deleted an update on ${name2(task.id)}`, before);
				return true;
			}
			case "relate":
				setDialog({ kind: "relate", from: model.findTask(data, rowId()).id, type: data.relationTypes[0]?.id ?? "", to: "" });
				return false;
			// A relation followed from the drawer: select that task in the table.
			case "open-task":
			case "open-related": {
				const id = name === "open-task" ? Number(String(p?.item ?? "").replace(/^rel:/, "")) : relatedId(String(p?.value ?? ""));
				const task = model.findTask(data, id ?? Number.NaN);
				// Where the sender sees it, maybe only as a parent standing in another group (`c<id>@<group>`).
				const row = shownRow(ev.view, task.id, t);
				if (!row) throw new InvalidInput(`#${task.id} is hidden by the search or filters.`);
				if (!c.navigate("tasks", { select: row })) throw new InvalidInput(`Find #${task.id} in the list.`);
				return false;
			}
			case "delete":
				model.deleteTask(data, rowId(), t);
				offerUndo(c, `Deleted ${name2(rowId())}`, before);
				return true;
			case "new-label":
				setDialog({ kind: "label", draft: labelDraft() });
				return false;
			case "edit-label": {
				const l = model.findLabel(data, rowId());
				setDialog({ kind: "label", id: l.id, draft: labelDraft(l) });
				return false;
			}
			case "delete-label": {
				const label = model.findLabel(data, rowId());
				model.deleteLabel(data, label.id, t);
				offerUndo(c, `Deleted the label “${label.name}”`, before);
				return true;
			}
			case "new-relation-type":
				setDialog({ kind: "relationType", name: "", inverse: "" });
				return false;
			case "edit-relation-type": {
				const rt = model.findRelationType(data, String(p?.rowId ?? "").slice(1));
				setDialog({ kind: "relationType", id: rt.id, name: rt.name, inverse: rt.inverse === rt.name ? "" : rt.inverse });
				return false;
			}
			case "delete-relation-type": {
				const rt = model.findRelationType(data, String(p?.rowId ?? "").slice(1));
				model.deleteRelationType(data, rt.id);
				offerUndo(c, `Deleted the relation type “${rt.name}”`, before);
				return true;
			}
			case "save":
				if (!dialog) return (unknown = true), false;
				if (dialog.kind === "task") {
					if (dialog.id) model.updateTask(data, dialog.id, dialog.draft, t);
					else {
						// Land on the new task in the list once the dialog closes.
						const start = dialog.start ?? newTaskStart();
						const related = start.related.map((r) => ({ type: r.key.replace(/^~/, ""), inverse: r.key.startsWith("~"), to: relatedId(r.value) }));
						if (related.some((r) => r.to === undefined || !data.tasks.some((x) => x.id === r.to))) throw new InvalidInput("A related task no longer exists.");
						const task = model.addTask(data, dialog.draft, t);
						for (const r of related) model.relate(data, task.id, r.type, r.to!, r.inverse, t);
						answer = { task: task.id };
						setDialog(undefined);
						c.navigate("tasks", { select: String(task.id) });
						// Its starting state: Snoozed and Watching ask when, in their dialog, on the new task.
						if (start.state === "snoozed") setDialog(snoozeDialog(task, t));
						else if (start.state === "watching") setDialog(watchDialog(task, t));
						else if (start.state !== "inbox") life.transition(data, task.id, start.state, {}, t);
						return true;
					}
				} else if (dialog.kind === "relate") {
					if (!dialog.to) throw new InvalidInput("Choose a task.");
					const inverse = dialog.type.startsWith("~");
					model.relate(data, dialog.from, dialog.type.replace(/^~/, ""), Number(dialog.to), inverse, t);
				} else if (dialog.kind === "snooze") {
					const due = model.parseDue(dialog.until) ?? "";
					if (!due) throw new InvalidInput("Choose when it should come back.");
					const until = model.dueAt(due.includes("T") ? due : `${due}T09:00`);
					life.transition(data, dialog.id, "snoozed", { until }, t);
					setDialog(undefined);
					offerUndo(c, `Snoozed ${name2(dialog.id)} until ${new Date(until).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}`, before);
					return true;
				} else if (dialog.kind === "watch") {
					const repeat = REPEATS.find((r) => r.id === dialog.repeat) ?? REPEATS[0]!;
					let next: number | undefined;
					if (repeat.id !== "none") {
						const due = model.parseDue(dialog.next) ?? "";
						if (!due) throw new InvalidInput("Choose when to check in, or No reminders.");
						next = model.dueAt(due.includes("T") ? due : `${due}T09:00`);
					}
					life.transition(data, dialog.id, "watching", { watch: { on: dialog.on, every: repeat.every, next, note: dialog.note } }, t);
					setDialog(undefined);
					offerUndo(c, `${dialog.checkIn ? "Still watching" : "Watching"} ${name2(dialog.id)} · ${nextCheckIn(dialog.id)}`, before);
					return true;
				} else if (dialog.kind === "updates") {
					const e = dialog.editing;
					if (!e) {
						answer = { task: dialog.id, update: model.addUpdate(data, dialog.id, dialog.draft, t).id };
						// Stay for the next one: the composer comes back empty (a new field id) and focused.
						// A next step closes: the task is back to work.
						setDialog(dialog.resume ? undefined : { kind: "updates", id: dialog.id, draft: "" });
						return true;
					}
					const was = model.findUpdate(model.findTask(data, dialog.id), e.update);
					const added = model.fromLocalInput(e.added, was.added, "Added");
					// Last updated follows the text unless the person set it.
					const setUpdated = e.updated !== model.toLocalInput(was.updated);
					model.editUpdate(data, dialog.id, e.update, { text: e.text, added, ...(setUpdated && { updated: model.fromLocalInput(e.updated, was.updated, "Last updated") }) }, t);
					setDialog(e.closeAfter ? undefined : { kind: "updates", id: dialog.id, draft: dialog.draft });
					return true;
				} else if (dialog.kind === "label") {
					const input = labelInput(dialog.draft);
					if (dialog.id) {
						// Values taken off tasks (removed, or the label made yes/no) can be undone.
						const id = dialog.id;
						const had = data.tasks.filter((task) => task.labels[id] !== undefined).length;
						const label = model.updateLabel(data, id, input, t);
						const lost = had - data.tasks.filter((task) => task.labels[id] !== undefined).length;
						if (lost) {
							setDialog(undefined);
							offerUndo(c, `Saved ${label.name}; ${lost} task${lost === 1 ? " lost its value" : "s lost their values"}`, before);
							return true;
						}
					} else answer = { label: model.addLabel(data, input).id };
				} else if (dialog.kind === "relationType") {
					model.saveRelationType(data, { id: dialog.id, name: dialog.name, inverse: dialog.inverse });
				}
				setDialog(undefined);
				return true;
		}
		unknown = true;
		return false;
	}

	return {
		views: () => {
			const declaration = display.viewDeclaration(loadOnce());
			declared = JSON.stringify(declaration);
			return { "screen:tasks": declaration };
		},
		actions: ACTIONS,
		forms: FORMS,
		start(c) {
			context = c;
			loadOnce();
			// Catch up on snoozes and due dates that passed while closed (saved on the next change).
			life.tick(data, now());
			badge(c);
			schedule();
		},
		// Every change is written before its event returns, so there is never pending work.
		prepare: () => ({ ready: true }),
		stop() {
			clearTimeout(timer);
			clearTimeout(reading);
		},
		render: {
			"screen:tasks": (_c, v) => tasksScreen(data, screenView(v), now()),
			// The screen id stays `labels` (renderer state and shortcuts key on it); it's titled Settings.
			"screen:labels": (_c, v) => settingsScreen(data, screenView(v), now()),
			quick: () => quickView(data, now()),
		},
		onView(surface, v, c) {
			catchUp(c);
			if (surface !== "screen:tasks") return;
			// The list nests at most MAX_LEVELS deep; the toolbar won't group further, and no view may.
			if (display.requestedLevels(data, v) > display.MAX_LEVELS) return false;
			// A task the person filters or searches away before it reads stays unread.
			if (v.instance === PERSON && readingId !== undefined && !shownRow(v, readingId, now())) {
				clearTimeout(reading);
				readingId = undefined;
			}
		},
		// An agent's instance closes with its dialog; the person's dialog stays for their next look.
		onClose(_surface, _c, { instance, origin }) {
			if (origin === "agent") dialogs.delete(instance);
		},
		onEvent(surface, name, payload, c, ev) {
			// Work on a copy so a rejected change leaves the data exactly as it was.
			const before = structuredClone(data);
			const offered = undo;
			answer = undefined;
			unknown = false;
			try {
				// Catch up with the clock first (a snooze may have ended since the last timer).
				const timed = life.tick(data, now());
				let changed = onEvent(surface, name, payload, c, before, ev);
				// A stalled task touched by this change (its next step written, or edited) is back to work.
				for (const id of life.resumeTouched(data, now())) {
					c.toast(`#${id} is back in Working on`, "success");
					changed = true;
				}
				// Labels come and go; the stored filter row follows them.
				data.filters = display.normalizeFilters(data);
				// A later change withdraws the standing Undo, which would discard it.
				if (undo && undo === offered && (changed || timed)) undo = undefined;
				if (changed || timed) {
					life.tick(data, now());
					save(data);
					badge(c);
					schedule();
				}
				if (unknown) return false;
				return answer && { data: answer };
			} catch (e) {
				data = before;
				undo = offered;
				if (!(e instanceof InvalidInput)) throw e;
				// The message shows where the sender acted: in the open dialog on Save, else as a toast
				// (an agent gets it in the result instead), and the event reports it as its error.
				const dialog = dialogs.get(ev.instance);
				if (dialog && name === "save") dialog.error = e.message;
				else if (ev.origin === "person") c.toast(e.message, "error");
				throw new Error(e.message);
			} finally {
				// So do the view declarations (a filter per label), whether the change held or was rejected.
				redeclare(c);
				c.invalidate();
			}
		},
	};
}
