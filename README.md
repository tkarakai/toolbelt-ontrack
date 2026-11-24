# Toolbelt OnTrack

OnTrack is a simple, flexible task tracker for [Toolbelt](https://github.com/tkarakai/toolbelt).
You create and manage every task yourself; nothing is imported or synced.

## Use

In Toolbelt's plugin manager, enter `tkarakai/toolbelt-ontrack`, review the release and publisher,
and approve execution. Plugin code runs with your user privileges; process isolation is not a
security sandbox.

OnTrack borrows the shape of T3 Code's thread list. You play the agent's part today; the model
keeps room for a real agent later.

- **Tasks** is grouped by Status to start with, in sections. There is no Pinned section: to keep
  some tasks in view, give them a yes/no label (say, *Pinned*) and filter by it. **Inbox** holds
  open tasks in your order; new tasks and tasks that come back land at the top. **Progressing**
  holds everything still in motion, in three sub-sections, one per state: **Working on it**, what
  you're doing now, in your order; **Snoozed**, hidden until its wake time, soonest first; and
  **Watching**, tasks out of your hands for now, next check-in first (see [Watching](#watching)).
  No task sits directly under Progressing; each sub-section shows even when it's empty and
  collapses on its own. **Settled** (done) is a collapsed shelf, newest first. **Archived** tasks
  are out of the way: include *Archived* in the Status filter and they show in a last, dimmed,
  collapsed group, newest archived first. You can group and filter by Due and by any label too:
  see [Filters and grouping](#filters-and-grouping). **New task** is N; once it's saved, the list
  lands on it.
- **Keys** follow the [state machine](#states-and-keys): P starts work or brings a task back to
  the Inbox; Z, W and S snooze, watch and settle. **A** archives and unarchives. **E** edits,
  **↵** or **⇧U** adds an update, **R** relates, **U** marks read/unread, **⌥↑/⌥↓** move (Inbox
  and Working on it), and **Delete** is in the ⋯ menu.
- **Undo** follows every move between states (by key, drag, the drawer's Status or the quick
  view) and every removal: archiving or deleting a task, deleting an update, removing a
  relation, deleting a label or relation type. Click it or press ⌘Z (in a text field ⌘Z still
  undoes your typing). It lasts as long as its toast (eight seconds) and
  reverts only the latest change: a newer change, other than opening a task or changing the
  filters, withdraws it, so Undo never discards work done since. Edits, new tasks and updates, read/unread, unarchiving
  and reordering don't offer it.
- **Drag** tasks within the Inbox and Working on it to order them, or between groups. A drop
  into a Status group is the same move as its key and follows the same
  [state machine](#states-and-keys): into the Inbox is P, onto Settled settles, into Snoozed or
  Watching opens the same dialog as Z or W, onto Archived archives (and out of it unarchives),
  and a move the keys don't allow (Snoozed straight to Working on it, say) is refused with a
  hint. A drop lands in the sub-section it's in; a drop on the Progressing header itself starts
  work. A drop into a label's group sets that value (into its *No* group clears it), and into
  Due's Today or No date sets or clears the due date; one Undo reverts the whole drop.
- **Unread** tasks are bold with a blue dot and say why: back from Working on it, the snooze ended, a
  check-in came due (spelled out: who it's waiting on, for how long, the last check and how
  often), the due date arrived, a task blocking it was settled, or all its subtasks were settled. Keeping a
  task open for about two seconds marks it read. Nothing settles on its own.
- Search matches names, descriptions, updates and label values.
- The **details drawer** is where you edit a task: see [Editing in the drawer](#editing-in-the-drawer).
- **Settings** (⌘S) defines labels (with color swatches) and relation types; each table has its
  own New button above it.
- The menu-bar **quick view** is a focus list in the table's order: the Inbox, then what you're
  working on (with elapsed time and its latest update). Each task shows one icon for its state;
  unread tasks are bold with a blue dot, overdue ones have a red dot and a red title, as in the table. Without opening the window you can
  jot a new task into the Inbox (N, then ↵), start or stop working (P), add an update (U, then ↵),
  settle (S), snooze (Z) and, on a task back from a check-in, watch it again (W). Z and W open
  their dialog in the main window, on the task. Enter opens the task in the main window. The
  plugin badge counts open tasks that are unread or overdue.

### Filters and grouping

The toolbar has one filter per thing a task has: **Status**, **Due** and each label. Each one
narrows the list to the values you check (**Show all** clears them; nothing checked means no
filtering), and each can **group** the list by its values with the **Group by** switch at the top
of its menu. Grouping filters come first in the row, numbered by level with › between them,
then a divider and the rest; the list nests in that order. Drag a filter to reorder the levels,
or across the divider to start or stop grouping by it (⌥← / ⌥→ on a focused filter does the
same). Turning Group by on adds the filter as the last level; turning it off puts it first among
the rest. Everything here is saved; the search isn't.

- **Status** offers the five states and Archived. It starts on *Ongoing* (everything but
  Archived), and **Reset to Ongoing** brings that back.
- **Due** offers Overdue (open tasks past due), Today, Next 6 days, Later, Past (finished tasks
  with an earlier date) and No date. Groups move on by themselves at midnight.
- A **label** offers its values and *No <label>* (a yes/no label: Yes and No).

Groups show only when they have tasks, except at the top of a Status grouping, where each state
you show is there even when empty, as before. Settled and Archived start collapsed. Grouping
goes 10 levels deep at most (Status counts two, for Progressing); a filter that would go deeper
can't turn Group by on and says why. Tasks keep Status order inside every group (each state's
own order, then Archived). Dragging to reorder Inbox and Working on it works when Status is the
last level; elsewhere a drag moves a task between groups.

### Editing in the drawer

The details drawer edits the selected task in place; there's no dialog to open. → moves into it
(opening it if it's closed) and Esc comes back to the list. From top to bottom:

- A bar of icons for the task's main actions (Start, Settle, Snooze, Watch…), with every action in
  the ⋯ menu.
- The **name**, large: click it (or press E on the task) to rename it; ↵ saves, Esc puts it back.
- **Status**, **Due** and **Labels**, which read as text until you point at them: pick a status
  (Snooze asks until when), a due date, or add, change and remove label pills.
- The **description**, formatted: click it or press ↵ on it to edit the Markdown; leaving it or
  ⌘↵ saves, Esc puts it back.
- One quiet line of facts: the ID, archived, time worked, when it was created and
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

### States and keys

A task is in one state at a time, and the table below is every move it can make: the keys, a
drag, the drawer's Status and the quick view all go through it, and anything else is refused
with a hint (for example "Bring it back to the Inbox first (P), then start working on it.").
**P** is the way back: it starts work from the Inbox and brings a task back to the Inbox from
anywhere else. **Z**, **W** and **S** put a task in Snoozed, Watching or Settled, or change it
when it's already there.

| From \ key | **P** | **Z** | **W** | **S** |
| --- | --- | --- | --- | --- |
| **Inbox** | → Working on it | → Snoozed (menu) | → Watching (dialog) | → Settled |
| **Working on it** | → Inbox (Done for now, unread) | → Snoozed | → Watching | → Settled |
| **Snoozed** | → Inbox (wake) | change the snooze time | → Watching | → Settled |
| **Watching** | → Inbox (stop watching) | — | change the watch | → Settled |
| **Settled** | → Inbox (reopen) | — | → Watching | — |
| *Archived* | **A** unarchives; E edits, ⇧U adds an update, Delete | | | |

Three rules keep it simple. **P** into the Inbox always marks the task unread, saying why (Back
from Working on it, Back from Snoozed, Back from Watching, Reopened from Settled); P into Working
on it reads it, since you just chose it. **Z** always asks how long (starting from the current
wake time when it's already snoozed), and **W** always asks when to check in, whether from the
key, a drag, the drawer's Status or the quick view. Snoozing a task in Watching or Settled needs
P first.

On their own: a snooze ending, a check-in coming due or a due date arriving brings a task back
to the top of the Inbox, unread, saying why. A task a check-in brought back stays watched (an eye
mark), so **W** from the Inbox is that check-in. The drawer's Status lists the same states, in the
same order (Inbox, Working on it, Snoozed, Watching, Settled), but only those the task can move
to from where it is. An archived task doesn't move until it's unarchived (A).

### Watching

Some tasks aren't done but aren't yours to move right now: you signed up and are waiting for the
other side to enable it, or something just needs a look once a month. **Watch…** (W, or Watching…
in the drawer's Status, or a drag into the Watching sub-section) puts a task in Watching, from any section,
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

- Nothing's changed: **Watch** it again (W). The dialog is titled *Check in*: it proposes the
  next date on the schedule (a week out for a one-off watch), with quick picks, and takes an
  optional note. A date on the schedule keeps it; another date restarts it from there; No
  reminders turns them off. **Keep watching** writes `Checked in: still waiting on Cobra team.`
  (and your note) as an update and sends the task back to Watching.
- It's on you again: **Start working on it** (P), which ends its watch.
- It's finished: **Settle** (S).

In Watching, **W** changes the watch (not a check) and **P** stops watching: back to the Inbox as
an ordinary task.

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
- **Text** labels pick one value from their list (Priority: High, Medium, Low). With **Allow
  free-form values**, a task can also use a new value, which then joins the list (Project).

The label editor keeps a text label's values in one list: type in the last row to add one
(Return keeps adding; pasting several lines adds one value per line), click a value to rename
it, drag its grip or press ⌥↑ ⌥↓ to move it, and remove it with ×. Each value shows how many
tasks use it. Renaming a value renames it on those tasks (renaming it to another value's name
merges the two); removing one takes it off them, and saving then offers Undo.

**Colors**: a text label draws its values either in one **label color** or **each in its own
color** (the label then shows a rainbow dot instead of a color of its own). Every value gets a color when it's added (one the label uses least, never grey) and
keeps it through renames and moves; with a color per value, click a value's dot to change it.
With one color, the values can instead get their own **intensity** of it, in list order:
strongest first (High · Medium · Low, as Priority does on a fresh install) or lightest first.
Every shade and color keeps its text readable in light and dark themes.

A fresh install has Project and Status coloring each value, isPersonal, and Priority shading
its values (Status: Todo, In progress, Blocked; done is Settled). Colors show on pills, filter
dots, details and in the task editor's value picker. Deleting a label removes it from every
task.

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
