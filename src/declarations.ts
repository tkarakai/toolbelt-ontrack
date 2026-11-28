// What each of OnTrack's actions and forms does (plugin protocol 3). Toolbelt refuses a screen
// that uses an id missing here, and agents acting on OnTrack ask the person before anything
// that isn't `view`. Opening a dialog is `view`; its Save is the change.
import type { ActionDeclaration, FormDeclaration } from "@toolbelt/sdk";

/** The Snooze menu's times (`snoozeChoices` in lifecycle.ts offers those still ahead). */
export const SNOOZE_CHOICE_IDS = ["3h", "evening", "tomorrow", "monday"] as const;

const write = (describe?: string): ActionDeclaration => ({ effect: "write", ...(describe && { describe }) });
const view = (describe?: string): ActionDeclaration => ({ effect: "view", ...(describe && { describe }) });

export const ACTIONS: Record<string, ActionDeclaration> = {
	// ── the state machine (TRANSITIONS in lifecycle.ts) ──
	work: write("Starts working on the task: it moves to Working on."),
	done: write("Stops working on it for now: back to the Inbox. It doesn't finish the task; Settle does."),
	wake: write("Ends the snooze: back to the Inbox."),
	unwatch: write("Stops watching it: back to the Inbox."),
	reopen: write("Reopens a settled task: back to the Inbox."),
	unstall: write("Back to the Inbox from Stalled."),
	resume: view("Opens the Next step box for a stalled task; adding that update moves it back to Working on."),
	stall: write("Marks a task you're working on stalled."),
	settle: write("Marks the task done: it moves to Settled."),
	unsettle: write("Marks a settled task not done: back to the Inbox."),
	snooze: view("Opens the Snooze dialog to choose when the task comes back."),
	...Object.fromEntries(SNOOZE_CHOICE_IDS.map((id) => [`snooze:${id}`, write("Snoozes the task until this time.")])),
	watch: view("Opens the Watch dialog: who the task waits on and when to check in."),
	// ── the rest of a task's actions ──
	edit: view("Opens the Edit dialog."),
	"add-update": write("Adds an update to the task with `text`; without text it opens the Updates dialog."),
	relate: view("Opens the Relate dialog."),
	"mark-read": write(),
	"mark-unread": write(),
	indent: write("Makes the task a subtask of the task above it."),
	outdent: write("Moves a subtask out a level."),
	up: write(),
	down: write(),
	archive: write(),
	unarchive: write(),
	delete: { effect: "destructive" },
	"new-task": view("Opens the New task dialog."),
	"quick-task": write("Adds a task named `text` to the Inbox."),
	// ── updates ──
	"edit-update-text": write(),
	"edit-update": view("Opens an update to change its text and times."),
	"update-back": view(),
	"delete-update": { effect: "destructive" },
	// Following a relation selects that task.
	"open-task": view(),
	"open-related": view(),
	// ── dialogs and toasts ──
	save: write("The dialog's main button: saves it."),
	undo: write(),
	// ── Settings ──
	"new-label": view("Opens the New label dialog."),
	"edit-label": view("Opens the label editor."),
	"delete-label": { effect: "destructive" },
	"new-relation-type": view("Opens the New relation type dialog."),
	"edit-relation-type": view("Opens the relation type editor."),
	"delete-relation-type": { effect: "destructive" },
};

/** Dialog forms edit a draft until Save (`view`); the drawer and Settings save as they change. */
export const FORMS: Record<string, FormDeclaration> = {
	task: { effect: "write" },
	"task-draft": { effect: "view" },
	relate: { effect: "view" },
	snooze: { effect: "view" },
	watch: { effect: "view" },
	"update-new": { effect: "view" },
	"update-edit": { effect: "view" },
	label: { effect: "view" },
	"label-values": { effect: "view" },
	"label-color": { effect: "view" },
	relationType: { effect: "view" },
	stall: { effect: "write" },
};
