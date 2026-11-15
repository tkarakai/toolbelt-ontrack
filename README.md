# Toolbelt OnTrack

OnTrack is a simple, flexible task tracker for [Toolbelt](https://github.com/tkarakai/toolbelt).
You create and manage every task yourself; nothing is imported or synced.

## Use

In Toolbelt's plugin manager, enter `tkarakai/toolbelt-ontrack`, review the release and publisher,
and approve execution. Plugin code runs with your user privileges; process isolation is not a
security sandbox.

OnTrack borrows the shape of T3 Code's thread list. You play the agent's part today; the model
keeps room for a real agent later.

- **Tasks** shows five sections. **Pinned** stays on top in your order. **Inbox** holds open tasks
  in your order; new tasks and tasks that come back land at the top. **Working** is what you're
  doing now, in your order. **Snoozed** is hidden until its wake time, soonest first. **Settled**
  (done) is a collapsed shelf, newest first. **Archived** tasks leave the sections; switch to
  *Archived* in the toolbar to see them. **New task** is N.
- **Start working on this** (W) moves a task to Working, like sending an agent a message.
  **Done for now** (D) sends it back to the top of the Inbox, unread, like an agent finishing its
  turn. **Settle** (S), **Un-settle** (S), **Snooze** (Z, with 3 hours, this evening, tomorrow
  9:00, next Monday 9:00 or a custom time), **Wake now** (W), **Pin/Unpin** (P), **Mark
  read/unread** (U), **Move up/down** (⌥↑/⌥↓), **Archive** (A), **Edit** (E), **Relate to…** (R)
  and **Delete** act on the selected task. Settle, snooze, unpin, archive and delete offer
  **Undo** for five seconds.
- **Drag** tasks within Pinned, Inbox and Working to order them, or between sections: into Pinned
  pins, into Working starts work, Working → Inbox is Done for now, onto Settled settles, out of
  Snoozed wakes, out of Settled un-settles. Nothing drops into Snoozed, which needs a wake time.
- **Unread** tasks are bold with a blue dot and say why: back from Working, the snooze ended, the
  due date arrived, a task blocking it was settled, or all its subtasks were settled. Opening a
  task marks it read. Nothing settles on its own.
- Search matches names, descriptions and label values; each label is a toolbar filter. The
  details drawer shows state, time spent, labels, related tasks and the description.
- **Settings** (⌘S) defines labels (with color swatches) and relation types; each table has its
  own New button above it.
- The menu-bar **quick view** is a focus list: what you're working on (with elapsed time), then
  Pinned and the Inbox in your order, with Done for now / Start working and Settle buttons. Enter
  opens the task in the main window. The plugin badge counts open tasks that are unread or
  overdue.

### Tasks

A task has an automatic ID, a name, created and last-updated times, an optional due date with an
optional time (local time; a date alone is due at the end of that day), a Markdown description
edited with live styling, at most one value per label (edited as colored pills), relations to
other tasks, and its place in the sections above, including work sessions for time spent.

### Labels

A label has a name, a color and a type:

- **Yes/no** labels are either on a task or not (isPersonal).
- **Lookup** labels pick one value from their list (Priority: High, Medium, Low).
- **Free text** labels accept any value; their list, if any, holds suggestions, followed by the
  values other tasks already use (Project).

A text label can give its listed values their own **intensity** of its color, in list order:
strongest first (High · Medium · Low, as Priority does on a fresh install) or lightest first.
Every shade keeps its text readable in light and dark themes.

A fresh install has Project, isPersonal, Priority and Status (Todo, In progress, Blocked; done is
Settled). The label's color is used for its pills, filter dots and details. Narrowing a lookup list or deleting a label removes the values
tasks can no longer have.

### Relations

A relation type has a name and how it reads from the other task: Parent/Child,
Related to, Supersedes/Superseded by and Blocks/Blocked by to start with. A relation is stored
once and shown on both tasks. A task can't be related to itself, and parent relations can't form
a cycle. Deleting a task removes its relations; a relation type in use can't be deleted.

Data lives in `ontrack.json` in the plugin's managed data folder. Removing the plugin retains data
unless you choose to delete it.

## Develop and maintain

Read [the architecture](docs/architecture.md) and [agent instructions](AGENTS.md).

```sh
bun install --frozen-lockfile
bun run typecheck
bun test
bun run package
bun scripts/verify-package.ts
```

Releases follow [docs/releases.md](docs/releases.md).
