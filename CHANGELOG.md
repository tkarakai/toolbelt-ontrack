# Changelog

## Unreleased

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
