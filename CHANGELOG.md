# Changelog

## Unreleased
- **Progressing** gathers everything still in motion in three groups: Working on it, Snoozed and Watching. No task sits directly under it.
- **One state machine for every task.** P starts work from the Inbox and brings a task back to the Inbox from anywhere else (Done for now, wake, stop watching, reopen). Z, W and S snooze, watch and settle, or change the snooze or watch when the task is already there. A archives. D and the old Wake (W) and Un-settle (S) keys are gone; the README has the full table.
- Working is now called **Working on it**.
- After you create a task, the list selects it.
- **Pinned is gone.** Labels do the job: give tasks a yes/no label and filter by it. Tasks you had pinned get a yes/no **Pinned** label on upgrade, so you can still find them; delete the label if you don't need it.
- **Watching**, for tasks that are out of your hands but not done, such as waiting on another party or something to check now and then. Watch… (W) asks who it's waiting on and how often to check in (every week by default, or every 2 weeks, month, 3 months, day, once, or no reminders). Watched tasks wait in a Watching group under Progressing, next check-in first, and read like “Waiting on Cobra team · 3 weeks · every week”.
- At each check-in the task comes back to the top of the Inbox, unread, saying why: “Time to check in · waiting on Cobra team for 3 weeks · last checked 7 days ago · every week”. Watch it again (W, also in the quick view, which opens the window) to say you're still waiting: the dialog proposes the next date on the schedule and takes an optional note, logs the check as an update and sends the task back. Starting work, settling or P in Watching ends the watch. Watch from any section, Settled included, from the drawer's Status, or by dragging onto Watching (weekly).
- Existing data is upgraded to schema 4.

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
