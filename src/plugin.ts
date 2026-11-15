// Connects the SDK to the model: events change the data or the view, every data change is
// saved immediately, and the open surfaces re-render. In active mode a timer wakes snoozed
// tasks and announces due dates; probe mode starts no timers.
import type { Context, PluginDefinition } from "@toolbelt/sdk";
import * as life from "./lifecycle";
import * as model from "./model";
import { InvalidInput, type Data, type LabelType } from "./model";
import { attention, defaultSnooze, fieldValue, fromTagValues, initialView, quickView, settingsScreen, tasksScreen, updateDraft, type View } from "./ui";

export type Options = { load(): Data; save(data: Data): void; now?: () => number };

/** How long an Undo stays offered, as in T3 Code. */
export const UNDO_MS = 5_000;
/** The longest wait between checks, so a sleeping Mac catches up soon after waking. */
const TICK_MS = 60_000;

export function ontrack({ load, save, now = Date.now }: Options): PluginDefinition {
	let data: Data = model.seed();
	const view: View = initialView();
	let undo: { data: Data; until: number } | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let context: Context | undefined;

	const badge = (c: Context) => c.badge(attention(data, now()) || null);

	/** Saves, updates the badge and re-renders after a change that came from the clock. */
	function onTime() {
		if (life.tick(data, now()) && context) {
			save(data);
			badge(context);
			context.invalidate();
		}
		schedule();
	}
	function schedule() {
		if (!context || context.mode !== "active") return;
		clearTimeout(timer);
		const next = life.nextWake(data, now());
		timer = setTimeout(onTime, Math.max(1_000, Math.min(TICK_MS, (next ?? Infinity) - now())));
	}

	/** Offers Undo for a change that's easy to make by accident. */
	function offerUndo(c: Context, text: string, before: Data) {
		undo = { data: before, until: now() + UNDO_MS };
		c.toast(text, "default", { id: "undo", label: "Undo" });
	}

	/**
	 * A field of the drawer's property sheet. Status moves the task through its lifecycle
	 * (Snooze asks until when); the rest saves through the same checks as the Edit dialog.
	 */
	function editInPlace(task: model.Task, field: string, value: unknown, c: Context, before: Data): boolean {
		const t = now();
		if (field === "state") {
			const to = String(value);
			if (to === task.state) return false;
			if (to === "snoozed") {
				view.dialog = { kind: "snooze", id: task.id, until: defaultSnooze(t) };
				return false;
			}
			if (task.state === "settled") life.unsettle(data, task.id, t);
			else if (task.state === "snoozed") life.wake(data, task.id, t);
			if (to === "working" && task.state !== "working") life.startWorking(data, task.id, t);
			if (to === "inbox" && task.state === "working") life.doneForNow(data, task.id, t);
			if (to === "settled") (life.settle(data, task.id, t), offerUndo(c, `Settled #${task.id}`, before));
			return true;
		}
		const input = { name: task.name, due: task.due ?? "", desc: task.desc, labels: { ...task.labels } };
		if (field === "labels") input.labels = fromTagValues(Array.isArray(value) ? value : []);
		else if (field === "name" || field === "due" || field === "desc") input[field] = String(value);
		else return false;
		model.updateTask(data, task.id, input, t);
		return true;
	}

	/** Returns true when the data changed. */
	function onEvent(name: string, p: any, c: Context, before: Data): boolean {
		const dialog = view.dialog;
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
			life.snooze(data, rowId(), choice.until, t);
			offerUndo(c, `Snoozed ${name2(rowId())} until ${new Date(choice.until).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}`, before);
			return true;
		}
		switch (name) {
			case "search":
				view.query = String(p?.query ?? "");
				return false;
			case "filter":
				view.filters[String(p?.filter)] = Array.isArray(p?.values) ? p.values.map(String) : [];
				return false;
			case "dialog-close":
				view.dialog = undefined;
				return false;
			case "select": {
				// Opening a task marks it read.
				const task = p?.rowId ? data.tasks.find((x) => String(x.id) === p.rowId) : undefined;
				if (!task?.unread) return false;
				life.markRead(task);
				return true;
			}
			case "reorder":
				life.drop(data, Number(p?.rowId), p?.section as life.SectionId, p?.before ? Number(p.before) : null, t);
				return true;
			case "undo":
				if (!undo || undo.until < t) throw new InvalidInput("Too late to undo.");
				data = undo.data;
				undo = undefined;
				return true;
			case "field": {
				const value = fieldValue(p?.value);
				// The details drawer edits the task in place: each field saves on its own.
				if (p?.form === "task" && p?.rowId !== undefined) return editInPlace(model.findTask(data, rowId()), String(p.field), value, c, before);
				if (p?.form === "show") view.show = value === "archived" ? "archived" : "active";
				else if (dialog?.kind === "task" && p?.form === "task") {
					if (p.field === "labels") dialog.draft.labels = fromTagValues(Array.isArray(value) ? value : []);
					else if (p.field === "name" || p.field === "due" || p.field === "desc") dialog.draft[p.field as "name"] = String(value);
				} else if (dialog?.kind === "relate" && p?.form === "relate") {
					if (p.field === "type") dialog.type = String(value);
					if (p.field === "to") dialog.to = String(value);
				} else if (dialog?.kind === "snooze" && p?.form === "snooze") {
					dialog.until = String(value);
				} else if (dialog?.kind === "label" && p?.form === "label") {
					const d = dialog.draft;
					if (p.field === "name" || p.field === "values" || p.field === "color" || p.field === "shades") d[p.field as "name"] = String(value);
					if (p.field === "type") d.type = value === "bool" ? "bool" : "string";
					if (p.field === "freeform") d.freeform = value === true;
				} else if (dialog?.kind === "relationType" && p?.form === "relationType") {
					if (p.field === "name" || p.field === "inverse") dialog[p.field as "name"] = String(value);
				} else if (dialog?.kind === "updates" && p?.form === "update-new") {
					dialog.draft = String(value);
				} else if (dialog?.kind === "updates" && dialog.editing && p?.form === "update-edit") {
					const field = String(p.field);
					if (field.startsWith("edit-text")) dialog.editing.text = String(value);
					if (field === "edit-added") dialog.editing.added = String(value);
					if (field === "edit-updated") dialog.editing.updated = String(value);
				}
				return false;
			}
			// ── lifecycle ──
			case "start":
				life.startWorking(data, rowId(), t);
				return true;
			case "done":
				life.doneForNow(data, rowId(), t);
				return true;
			case "wake":
				life.wake(data, rowId(), t);
				return true;
			case "settle":
				life.settle(data, rowId(), t);
				offerUndo(c, `Settled ${name2(rowId())}`, before);
				return true;
			case "unsettle":
				life.unsettle(data, rowId(), t);
				return true;
			case "snooze":
				view.dialog = { kind: "snooze", id: model.findTask(data, rowId()).id, until: defaultSnooze(t) };
				return false;
			case "pin":
				life.pin(data, rowId(), t);
				return true;
			case "unpin":
				life.unpin(data, rowId(), t);
				offerUndo(c, `Unpinned ${name2(rowId())}`, before);
				return true;
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
				view.dialog = { kind: "task", draft: { name: "", due: "", desc: "", labels: {} } };
				return false;
			case "edit": {
				const task = model.findTask(data, rowId());
				view.dialog = { kind: "task", id: task.id, draft: { name: task.name, due: task.due ?? "", desc: task.desc, labels: { ...task.labels } } };
				return false;
			}
			// ── updates ──
			case "add-update":
				// Written in the drawer's composer or the quick view; otherwise the Updates dialog.
				if (typeof p?.text === "string") {
					model.addUpdate(data, rowId(), p.text, t);
					return true;
				}
				view.dialog = { kind: "updates", id: model.findTask(data, rowId()).id, draft: "" };
				return false;
			case "edit-update-text": {
				const { task, update } = updateRef();
				model.editUpdate(data, task.id, update.id, { text: String(p?.text ?? "") }, t);
				return true;
			}
			case "quick-task": {
				const task = model.addTask(data, { name: String(p?.text ?? ""), due: "", desc: "", labels: {} }, t);
				c.toast(`Added #${task.id} to the Inbox`, "success");
				return true;
			}
			case "edit-update": {
				const { task, update } = updateRef();
				const fromDrawer = !(dialog?.kind === "updates" && dialog.id === task.id);
				view.dialog = { kind: "updates", id: task.id, draft: dialog?.kind === "updates" ? dialog.draft : "", editing: updateDraft(update, fromDrawer) };
				return false;
			}
			case "update-back":
				if (dialog?.kind !== "updates") return false;
				if (dialog.editing?.closeAfter) view.dialog = undefined;
				else view.dialog = { kind: "updates", id: dialog.id, draft: dialog.draft };
				return false;
			case "delete-update": {
				const { task, update } = updateRef();
				model.deleteUpdate(data, task.id, update.id, t);
				// Deleting the update being edited goes back to the list.
				if (dialog?.kind === "updates" && dialog.editing?.update === update.id) view.dialog = { kind: "updates", id: dialog.id, draft: dialog.draft };
				offerUndo(c, `Deleted an update on ${name2(task.id)}`, before);
				return true;
			}
			case "relate":
				view.dialog = { kind: "relate", from: model.findTask(data, rowId()).id, type: data.relationTypes[0]?.id ?? "", to: "" };
				return false;
			case "unrelate": {
				const [holder, type, target] = String(p?.target ?? "").split(":");
				model.unrelate(data, Number(holder), type ?? "", Number(target), t);
				return true;
			}
			case "delete":
				model.deleteTask(data, rowId(), t);
				offerUndo(c, `Deleted ${name2(rowId())}`, before);
				return true;
			case "new-label":
				view.dialog = { kind: "label", draft: { name: "", type: "string", color: "blue", values: "", freeform: false, shades: "" } };
				return false;
			case "edit-label": {
				const l = model.findLabel(data, rowId());
				view.dialog = { kind: "label", id: l.id, draft: { name: l.name, type: l.type, color: l.color, values: l.values.join(", "), freeform: l.freeform, shades: l.shades ?? "" } };
				return false;
			}
			case "delete-label":
				model.deleteLabel(data, rowId(), t);
				return true;
			case "new-relation-type":
				view.dialog = { kind: "relationType", name: "", inverse: "" };
				return false;
			case "edit-relation-type": {
				const rt = model.findRelationType(data, String(p?.rowId ?? "").slice(1));
				view.dialog = { kind: "relationType", id: rt.id, name: rt.name, inverse: rt.inverse === rt.name ? "" : rt.inverse };
				return false;
			}
			case "delete-relation-type":
				model.deleteRelationType(data, String(p?.rowId ?? "").slice(1));
				return true;
			case "save":
				if (!dialog) return false;
				if (dialog.kind === "task") {
					if (dialog.id) model.updateTask(data, dialog.id, dialog.draft, t);
					else model.addTask(data, dialog.draft, t);
				} else if (dialog.kind === "relate") {
					if (!dialog.to) throw new InvalidInput("Choose a task.");
					const inverse = dialog.type.startsWith("~");
					model.relate(data, dialog.from, dialog.type.replace(/^~/, ""), Number(dialog.to), inverse, t);
				} else if (dialog.kind === "snooze") {
					const due = model.parseDue(dialog.until) ?? "";
					if (!due) throw new InvalidInput("Choose when it should come back.");
					life.snooze(data, dialog.id, model.dueAt(due.includes("T") ? due : `${due}T09:00`), t);
				} else if (dialog.kind === "updates") {
					const e = dialog.editing;
					if (!e) {
						model.addUpdate(data, dialog.id, dialog.draft, t);
						// Stay for the next one: the composer comes back empty (a new field id) and focused.
						view.dialog = { kind: "updates", id: dialog.id, draft: "" };
						return true;
					}
					const was = model.findUpdate(model.findTask(data, dialog.id), e.update);
					const added = model.fromLocalInput(e.added, was.added, "Added");
					// Last updated follows the text unless the person set it.
					const setUpdated = e.updated !== model.toLocalInput(was.updated);
					model.editUpdate(data, dialog.id, e.update, { text: e.text, added, ...(setUpdated && { updated: model.fromLocalInput(e.updated, was.updated, "Last updated") }) }, t);
					view.dialog = e.closeAfter ? undefined : { kind: "updates", id: dialog.id, draft: dialog.draft };
					return true;
				} else if (dialog.kind === "label") {
					const d = dialog.draft;
					const input = { ...d, type: d.type as LabelType, values: d.values.split(",") };
					if (dialog.id) model.updateLabel(data, dialog.id, input, t);
					else model.addLabel(data, input);
				} else if (dialog.kind === "relationType") {
					model.saveRelationType(data, { id: dialog.id, name: dialog.name, inverse: dialog.inverse });
				}
				view.dialog = undefined;
				return true;
		}
		return false;
	}

	return {
		start(c) {
			context = c;
			data = load();
			// Catch up on snoozes and due dates that passed while closed (saved on the next change).
			life.tick(data, now());
			badge(c);
			schedule();
		},
		// Every change is written before its event returns, so there is never pending work.
		prepare: () => ({ ready: true }),
		stop() {
			clearTimeout(timer);
		},
		render: {
			"screen:tasks": () => tasksScreen(data, view, now()),
			// The screen id stays `labels` (renderer state and shortcuts key on it); it's titled Settings.
			"screen:labels": () => settingsScreen(data, view, now()),
			quick: () => quickView(data, now()),
		},
		onEvent(_surface, name, payload, c) {
			// Work on a copy so a rejected change leaves the data exactly as it was.
			const before = structuredClone(data);
			try {
				// Catch up with the clock first (a snooze may have ended since the last timer).
				const timed = life.tick(data, now());
				if (onEvent(name, payload, c, before) || timed) {
					life.tick(data, now());
					save(data);
					badge(c);
					schedule();
				}
			} catch (e) {
				data = before;
				if (!(e instanceof InvalidInput)) throw e;
				if (view.dialog && name === "save") view.dialog.error = e.message;
				else c.toast(e.message, "error");
			}
			c.invalidate();
		},
	};
}
