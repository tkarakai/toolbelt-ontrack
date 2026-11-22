# Toolbelt OnTrack

OnTrack is a simple, flexible task tracker for [Toolbelt](https://github.com/tkarakai/toolbelt).
You create and manage every task yourself; nothing is imported or synced.

## Use

In Toolbelt's plugin manager, enter `tkarakai/toolbelt-ontrack`, review the release and publisher,
and approve execution. Plugin code runs with your user privileges; process isolation is not a
security sandbox.

OnTrack borrows the shape of T3 Code's thread list. You play the agent's part today; the model
keeps room for a real agent later.

- **Tasks** shows six sections. **Pinned** stays on top in your order. **Inbox** holds open tasks
  in your order; new tasks and tasks that come back land at the top. **Working** is what you're
  doing now, in your order. **Watching** (collapsed) holds tasks that are out of your hands for
  now, next check-in first: see [Watching](#watching). **Snoozed** is hidden until its wake time,
  soonest first. **Settled**
  (done) is a collapsed shelf, newest first. **Archived** tasks leave the sections; switch to
  *Archived* in the toolbar to see them. **New task** is N.
- **Start working on this** (W) moves a task to Working, like sending an agent a message.
  **Done for now** (D) sends it back to the top of the Inbox, unread, like an agent finishing its
  turn. **Settle** (S), **Un-settle** (S), **Snooze** (Z, with 3 hours, this evening, tomorrow
  9:00, next Monday 9:00 or a custom time), **Wake now** (W), **Watch…** (K), **Still waiting**
  (K), **Change watch…** (⇧K), **Stop watching**, **Pin/Unpin** (P), **Mark
  read/unread** (U), **Move up/down** (⌥↑/⌥↓), **Archive** (A), **Edit** (E), **Add update**
  (↵ or ⇧U), **Relate to…** (R) and **Delete** act on the selected task. Settle, snooze, watch,
  still waiting, unpin, archive and delete offer **Undo** for five seconds.
- **Drag** tasks within Pinned, Inbox and Working to order them, or between sections: into Pinned
  pins, into Working starts work, Working → Inbox is Done for now, onto Settled settles, out of
  Snoozed wakes, out of Settled un-settles. Onto Watching watches weekly (a task that was already
  watched gets Still waiting); out of Watching stops watching. Nothing drops into Snoozed, which
  needs a wake time.
- **Unread** tasks are bold with a blue dot and say why: back from Working, the snooze ended, a
  check-in came due (spelled out: who it's waiting on, for how long, the last check and how
  often), the due date arrived, a task blocking it was settled, or all its subtasks were settled. Opening a
  task marks it read. Nothing settles on its own.
- Search matches names, descriptions, updates and label values; each label is a toolbar filter.
- The **details drawer** is where you edit a task: see [Editing in the drawer](#editing-in-the-drawer).
- **Settings** (⌘S) defines labels (with color swatches) and relation types; each table has its
  own New button above it.
- The menu-bar **quick view** is a focus list: what you're working on (with elapsed time and its
  latest update), then Pinned and the Inbox in your order. Without opening the window you can
  jot a new task into the Inbox (N, then ↵), start or stop work (W/D), add an update (U, then ↵),
  snooze until tomorrow 9:00 (Z), settle (S) and, on a check-in, say you're still waiting (K). Enter opens the task in the main window. The
  plugin badge counts open tasks that are unread or overdue.

### Editing in the drawer

The details drawer edits the selected task in place; there's no dialog to open. → moves into it
(opening it if it's closed) and Esc comes back to the list. From top to bottom:

- A bar of icons for the task's main actions (Start, Settle, Snooze, Pin…), with every action in
  the ⋯ menu.
- The **name**, large: click it (or press E on the task) to rename it; ↵ saves, Esc puts it back.
- **Status**, **Due** and **Labels**, which read as text until you point at them: pick a status
  (Snooze asks until when), a due date, or add, change and remove label pills.
- The **description**, formatted: click it or press ↵ on it to edit the Markdown; leaving it or
  ⌘↵ saves, Esc puts it back.
- One quiet line of facts: the ID, pinned or archived, time worked, when it was created and
  changed. Related tasks follow when there are any.
- **Updates**: ↵ on a task in the list lands in the update box (or ⇧U). Write, press ⌘↵, and the
  box is ready for the next one. Below, every update, newest first: Tab into them, move with
  ↑/↓, press E (or ↵, or double-click) to edit an update's text in place, or ⌫ to delete it.
  Change times… adjusts when it was added or last updated.

When the window is too narrow for the drawer, Edit and Add update open their dialogs instead.

### Tasks

A task has an automatic ID, a name, created and last-updated times, an optional due date with an
optional time (local time; a date alone is due at the end of that day), a Markdown description
edited with live styling, a series of updates, at most one value per label (edited as colored
pills), relations to other tasks, and its place in the sections above, including work sessions
for time spent.

Dates use Toolbelt's date picker: type them the way you say them (`fri 5pm`, `+3d`, `next mon`,
`nov 20`), pick Today, Tomorrow, Next Monday or In a week, or move through the month with the
arrow and Page keys; ⌫ clears. Snooze's picker offers the Snooze menu's times as quick picks.

### Watching

Some tasks aren't done but aren't yours to move right now: you signed up and are waiting for the
other side to enable it, or something just needs a look once a month. **Watch…** (K, or Watching…
in the drawer's Status, or a drag onto Watching) puts a task in Watching, from any section,
Settled included. The Watch dialog asks:

- **Waiting on**: who or what, optional, suggesting the names you used before.
- **Check in**: every week (the default), every 2 weeks, every month, every 3 months, every day,
  once, or no reminders.
- **First check-in** (or **Check in on**): a week from today at 9:00 by default, with quick picks.
  Repeats keep its day and time (monthly on the 31st falls on the last day of shorter months).

A watched row reads `Waiting on Cobra team · 3 weeks · every week · checked 2×`, with its next
check-in in the When column. When a check-in comes due, the task goes back to the top of the
Inbox, unread, saying why: `Time to check in · waiting on Cobra team for 3 weeks · last checked 7
days ago · every week`. It stays watched, marked with an eye. Then:

- Nothing's changed: **Still waiting** (K) writes `Checked in: still waiting on Cobra team.` as an
  update and sends it back to Watching until the next check-in on its schedule. A one-off watch
  asks again in a week; checking before a check-in skips that one.
- It's on you again: **Start** (W). Working on a task ends its watch.
- It's finished: **Settle** (S). **Stop watching** turns it into an ordinary task.

A due date arriving brings a watched task back early too. The drawer shows the whole schedule:
since when, how often, the next check-in, and how many times you checked. Use updates for the
history and child tasks for concrete steps; both work as usual on a watched task.

### Updates

Updates record progress on a task: each has the time it was added, the time it was last updated
and a Markdown text. Add them in the details drawer (above) or from the quick view. Without the
drawer, **Add update** opens the task's updates in a dialog: write in the editor at the top and
press ⌘↵ to add it; the list below shows every update, newest first, where E edits an update
(its text, when it was added and when it was last updated) and ⌫ deletes it. Last updated moves
to now when you change the text, unless you set it yourself; neither time can be in the future,
and an update can't be last updated before it was added. Deleting offers Undo.

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
