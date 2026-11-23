# Changelog

## Unreleased

## 0.7.0 — 2026-11-23
- **Overdue tasks get a red dot and a red title**, in the table and the quick view; hovering the dot says “Overdue”. In the quick view every dot now sits before the title, the unread one first.
- **A task reads after about two seconds open**, not right away, so passing over it on the way elsewhere keeps it unread.
- Requires Toolbelt 0.3.15 (SDK 0.3.10).

## 0.6.0 — 2026-11-23
- **Progressing's Working on it, Snoozed and Watching are real sub-sections**: headers like a section's, indented under Progressing, each showing even when empty (“Nothing snoozed”), collapsing on its own and remembering it. A drag lands in the sub-section it's dropped in; a drop on the Progressing header itself starts work. Progressing's open/closed state starts fresh once.
- **⌘Z presses Undo** while its toast shows; in a text field ⌘Z still undoes your typing.
- Requires Toolbelt 0.3.14 (SDK 0.3.9).

## 0.5.0 — 2026-11-22
- **Progressing** gathers everything still in motion in three groups: Working on it, Snoozed and Watching. No task sits directly under it.
- **One state machine for every task.** P starts work from the Inbox and brings a task back to the Inbox from anywhere else (Done for now, wake, stop watching, reopen). Z, W and S snooze, watch and settle, or change the snooze or watch when the task is already there. A archives. D and the old Wake (W) and Un-settle (S) keys are gone; the README has the full table.
- **The state machine is enforced everywhere.** Keys, drags, the drawer's Status and the quick view all make the same moves, and a move the table doesn't allow (such as Snoozed straight to Working on it) is refused with a hint naming the key that helps. The drawer's Status lists only the states a task can move to from where it is, and archived tasks don't move until they're unarchived.
- **P into the Inbox always marks the task unread**, saying why (Back from Working on it, Back from Snoozed, Back from Watching, Reopened from Settled). **Z always asks how long and W always asks when to check in**, from the key, a drag, the drawer's Status or the quick view (which opens the dialog in the main window).
- Working is now called **Working on it**, and the toolbar's Tasks / Archived switch is now **Ongoing** / Archived.
- **Undo is consistent.** Every move between states offers it (starting work, Done for now, waking, stopping a watch, reopening, as well as settle, snooze and watch), whether by key, drag, the drawer's Status or the quick view, and so does every removal: removing a relation and deleting a label or relation type now offer it too. Undo lasts as long as its toast (eight seconds; it used to stop working after five while the button was still there).
- Fixed: Undo on an older toast reverted the latest change instead of its own; it now says only the latest change can be undone. Fixed: Undo after another change also threw away that later change; a later change now withdraws the Undo (opening a task doesn't).
- States and groups have OnTrack's own icons, one set drawn in thin, quiet strokes: Inbox (an arrow dropping into a tray), Progressing (a rising line), Working on it (play), Snoozed (a crescent moon), Watching (an eye) and Settled (a check), on section and group headers, drop targets, the When column, the watch mark and the quick view. Action buttons keep their icons.
- The quick view lists tasks in the table's order (the Inbox, then Working on it), and every task shows one icon for its state instead of the pulsing dot and mixed icons.
- After you create a task, the list selects it.
- **Pinned is gone.** Labels do the job: give tasks a yes/no label and filter by it. Tasks you had pinned get a yes/no **Pinned** label on upgrade, so you can still find them; delete the label if you don't need it.
- **Watching**, for tasks that are out of your hands but not done, such as waiting on another party or something to check now and then. Watch… (W) asks who it's waiting on and how often to check in (every week by default, or every 2 weeks, month, 3 months, day, once, or no reminders). Watched tasks wait in a Watching group under Progressing, next check-in first, and read like “Waiting on Cobra team · 3 weeks · every week”.
- At each check-in the task comes back to the top of the Inbox, unread, saying why: “Time to check in · waiting on Cobra team for 3 weeks · last checked 7 days ago · every week”. Watch it again (W, also in the quick view, which opens the window) to say you're still waiting: the dialog proposes the next date on the schedule and takes an optional note, logs the check as an update and sends the task back. Starting work, settling or P in Watching ends the watch. Watch from any section, Settled included, from the drawer's Status, or by dragging onto Watching (weekly).
- Existing data is upgraded to schema 4.
- Requires Toolbelt 0.3.13 (SDK 0.3.8).

## 0.4.0 — 2026-11-15
- Edit tasks right in the details drawer, without a dialog. The drawer is redesigned to be dense and to show each thing once: a bar of action icons, the name in large type (click it or press E to rename), Status, Due and Labels as quiet properties you change in place, the description as formatted text that becomes an editor when you click it, one line of facts (ID, time worked, created, changed), related tasks, and the updates.
- Write updates in the drawer: ↵ on a task (or ⇧U) goes straight to the update box; ⌘↵ adds the update and the box is ready for the next one. Edit an update's text in place with E, ↵ or a double-click; Change times… adjusts its times. Return no longer starts or stops work; use W and D.
- → on a task moves into its details (opening the drawer if needed), and Esc comes back to the list. The arrow keys keep the keyboard in the list, so ← / → and Tab no longer switch screens after you've moved through the tasks.
- The quick view does more without opening the window: jot a new task into the Inbox (N), add an update to a task (U), snooze it until tomorrow (Z), and see each task's latest update.
- Requires Toolbelt 0.3.12 (SDK 0.3.8).

## 0.3.0 — 2026-11-15
- Tasks have **updates**: a series of Markdown notes, each with when it was added and when it was last updated. Add update (⇧U) opens the task's updates with an editor on top (⌘Return adds, and the editor is ready for the next one) and every update below, newest first. Tab into the list, use ↑/↓, E to edit an update (its text and both times) and ⌫ to delete it; deleting can be undone. The details drawer lists the updates with their own Edit and Delete buttons, and search finds tasks by their updates.
- Due dates and snooze times use Toolbelt's new date picker. An empty due date now reads “No due date” instead of showing a date. Type dates like “fri 5pm”, “+3d” or “nov 20”, pick a quick choice (Snooze offers its menu's times), or use the arrow and Page keys in the calendar.
- Due dates read as “Today · 5:00 PM”, “Tomorrow” or “Fri, Nov 20”, and the details drawer shows times as “Nov 14, 9:30 AM”. Descriptions in the drawer are shown as formatted Markdown.
- Requires Toolbelt 0.3.11 (SDK 0.3.7). Existing data is upgraded: every task starts with no updates.

## 0.2.0 — 2026-11-15
- The task list reads like a document: one background, no lines between rows, rounded hovered and selected rows. Sections, nesting, dragging and the details drawer work as before.
- N creates a new task (shown on the New task button). The Name field has focus when a task dialog opens, Return saves, and ⌘Return saves from the description too.
- The Labels tab is now **Settings** (⌘S), with New label above the labels table and New relation type above the relation types table.
- A label can shade its listed values from strongest to lightest (or the reverse) in its color, for example High · Medium · Low. Priority does this on fresh installs.
- Requires Toolbelt 0.3.10 (SDK 0.3.6).
- Free-text labels such as Project suggest the values your other tasks already use.

## 0.1.0 — 2026-11-15
- Tasks live in T3 Code-style sections: Pinned, Inbox, Working, Snoozed and Settled, plus Archive.
  Start working on a task (W), send it back with Done for now (D), snooze it until a chosen time,
  settle it when it's done, pin it, or archive it. Settle, snooze, unpin, archive and delete can be
  undone for five seconds.
- Order Pinned, Inbox and Working by dragging or with ⌥↑/⌥↓. Dragging between sections pins,
  starts work, finishes for now, wakes, settles or un-settles.
- Unread tasks are bold with a blue dot and say why: back from Working, the snooze ended, the due
  date arrived, a blocker was settled, or all subtasks were settled. Opening a task marks it read.
- Edit descriptions in a Markdown editor that styles text as you type, pick due dates with a date
  and time picker, edit labels as colored pills, pick label colors from swatches, and find related
  tasks with a searchable list.
- The quick view is a focus list: what you're working on, then Pinned and the Inbox, with buttons
  to start, finish for now and settle. The badge counts unread and overdue tasks.
- Time spent on a task is recorded from its work sessions.
- Requires Toolbelt 0.3.9. Existing data is upgraded: tasks whose Status was Done are settled, and
  Status no longer has a Done value for new installs.
- Track tasks with an automatic ID, name, created and last-updated times, an optional due date
  and time, a Markdown description, label values and related tasks.
- Define colored labels (yes/no, lookup list or free text). Project, isPersonal, Priority and
  Status are created on first install.
- Relate tasks with named relation types read from both sides (Parent/Child, Related to,
  Supersedes/Superseded by, Blocks/Blocked by), with self, duplicate and parent-cycle checks.
- Search and filter tasks by any label.
