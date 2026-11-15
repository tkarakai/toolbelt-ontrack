// Connects the SDK to the model: events change the data or the view, every data change is
// saved immediately, and the open surfaces re-render.
import type { Context, PluginDefinition } from "@toolbelt/sdk";
import * as model from "./model";
import { InvalidInput, type Data, type LabelType } from "./model";
import { fieldValue, initialView, labelsScreen, overdue, quickView, tasksScreen, type View } from "./ui";

export type Options = { load(): Data; save(data: Data): void; now?: () => number };

export function ontrack({ load, save, now = Date.now }: Options): PluginDefinition {
	let data: Data = model.seed();
	const view: View = initialView();
	const badge = (c: Context) => {
		const n = overdue(data, now());
		c.badge(n || null);
	};

	function onEvent(name: string, p: any): boolean {
		const dialog = view.dialog;
		const rowNumber = () => Number(String(p?.rowId ?? "").replace(/^[lr]/, ""));
		switch (name) {
			case "search":
				view.query = String(p?.query ?? "");
				return false;
			case "filter":
				view.filters[String(p?.filter)] = Array.isArray(p?.values) ? p.values.map(String) : [];
				return false;
			case "sort":
				view.sort = { key: String(p?.key), desc: !!p?.desc };
				return false;
			case "dialog-close":
				view.dialog = undefined;
				return false;
			case "field": {
				const value = fieldValue(p?.value);
				if (p?.form === "show") view.show = value === "all" ? "all" : "open";
				else if (dialog?.kind === "task" && p?.form === "task") {
					const field = String(p.field);
					if (field.startsWith("label:")) dialog.draft.labels[field.slice(6)] = value as string | boolean;
					else if (field === "name" || field === "due" || field === "desc") dialog.draft[field] = String(value);
				} else if (dialog?.kind === "relate" && p?.form === "relate") {
					if (p.field === "type") dialog.type = String(value);
					if (p.field === "to") dialog.to = String(value);
				} else if (dialog?.kind === "label" && p?.form === "label") {
					const d = dialog.draft;
					if (p.field === "name" || p.field === "values" || p.field === "color") d[p.field as "name"] = String(value);
					if (p.field === "type") d.type = value === "bool" ? "bool" : "string";
					if (p.field === "freeform") d.freeform = value === true;
				} else if (dialog?.kind === "relationType" && p?.form === "relationType") {
					if (p.field === "name" || p.field === "inverse") dialog[p.field as "name"] = String(value);
				}
				return false;
			}
			case "new-task":
				view.dialog = { kind: "task", draft: { name: "", due: "", desc: "", labels: {} } };
				return false;
			case "edit": {
				const t = model.findTask(data, rowNumber());
				view.dialog = { kind: "task", id: t.id, draft: { name: t.name, due: t.due ? model.formatDue(t.due) : "", desc: t.desc, labels: { ...t.labels } } };
				return false;
			}
			case "relate":
				view.dialog = { kind: "relate", from: model.findTask(data, rowNumber()).id, type: data.relationTypes[0]?.id ?? "", to: "" };
				return false;
			case "unrelate": {
				const [holder, type, target] = String(p?.target ?? "").split(":");
				model.unrelate(data, Number(holder), type ?? "", Number(target), now());
				return true;
			}
			case "delete":
				model.deleteTask(data, rowNumber(), now());
				return true;
			case "new-label":
				view.dialog = { kind: "label", draft: { name: "", type: "string", color: "blue", values: "", freeform: false } };
				return false;
			case "edit-label": {
				const l = model.findLabel(data, rowNumber());
				view.dialog = { kind: "label", id: l.id, draft: { name: l.name, type: l.type, color: l.color, values: l.values.join(", "), freeform: l.freeform } };
				return false;
			}
			case "delete-label":
				model.deleteLabel(data, rowNumber(), now());
				return true;
			case "new-relation-type":
				view.dialog = { kind: "relationType", name: "", inverse: "" };
				return false;
			case "edit-relation-type": {
				const t = model.findRelationType(data, String(p?.rowId ?? "").slice(1));
				view.dialog = { kind: "relationType", id: t.id, name: t.name, inverse: t.inverse === t.name ? "" : t.inverse };
				return false;
			}
			case "delete-relation-type":
				model.deleteRelationType(data, String(p?.rowId ?? "").slice(1));
				return true;
			case "save":
				if (!dialog) return false;
				if (dialog.kind === "task") {
					if (dialog.id) model.updateTask(data, dialog.id, dialog.draft, now());
					else model.addTask(data, dialog.draft, now());
				} else if (dialog.kind === "relate") {
					if (!dialog.to) throw new InvalidInput("Choose a task.");
					const inverse = dialog.type.startsWith("~");
					model.relate(data, dialog.from, dialog.type.replace(/^~/, ""), Number(dialog.to), inverse, now());
				} else if (dialog.kind === "label") {
					const d = dialog.draft;
					const input = { ...d, type: d.type as LabelType, values: d.values.split(",") };
					if (dialog.id) model.updateLabel(data, dialog.id, input, now());
					else model.addLabel(data, input);
				} else {
					model.saveRelationType(data, { id: dialog.id, name: dialog.name, inverse: dialog.inverse });
				}
				view.dialog = undefined;
				return true;
		}
		return false;
	}

	return {
		start(c) {
			data = load();
			badge(c);
		},
		// Every change is written before its event returns, so there is never pending work.
		prepare: () => ({ ready: true }),
		render: {
			"screen:tasks": () => tasksScreen(data, view, now()),
			"screen:labels": () => labelsScreen(data, view),
			quick: () => quickView(data, now()),
		},
		onEvent(_surface, name, payload, c) {
			// Work on a copy so a rejected change leaves the data exactly as it was.
			const before = structuredClone(data);
			try {
				if (onEvent(name, payload)) {
					save(data);
					badge(c);
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
