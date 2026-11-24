# OnTrack architecture

OnTrack owns its screens, data model, schema, migration, tests and release packages. Toolbelt owns
rendering, plugin installation, the runtime process and managed-data recovery.

## Runtime and UI

Toolbelt launches the bundled `index.js` with Bun. The plugin uses the public `@toolbelt/sdk`
package over JSON lines on stdin/stdout; stderr is diagnostic output. UI is a declarative tree;
Toolbelt keeps selection, typing, scroll and drag feedback. Dialog drafts, search and the Undo
snapshot live in plugin memory and reset on restart; the filter row is saved with the data.

The stable plugin id is `ontrack`. Screens are `tasks` (default, shortcut T) and `labels` (titled
Settings, shortcut S; the id stays `labels`),
plus the `quick` surface. Task row ids are the task id as a string on both the table and the quick
list, so selection hands off between them. Label rows are `l<id>`, relation type rows `r<id>`.
The Tasks table (id `tasks`) declares `appearance: "document"`, `selectEvents`, `paneButtons`
and, while anything groups, `sections` and `reorder`; New task has key N. Its columns are the
name (the task id as its `prefix` pill), Due and When. An overdue task's red dot is `Row.dot`. The sections come from the filter
row (see [Filters and grouping](#filters-and-grouping)): with the default Status grouping they
are inbox, progressing (no rows of its own; sub-sections working, stalled, snoozed, watching), settled and,
when Archived is shown, archived, with the same ids as before. Each row's `group` is its innermost
section's id. Snoozed, Watching, Settled, Archived and label groups sort themselves (`order:
"fixed"`). Undo toasts carry `key: "cmd+z"` (`ui.toast-key`). Saving a new task calls `navigate("tasks", {select})` so the
list lands on it (optional `navigate` capability). Settings wraps each table in a card
whose action creates its kind of row. A `reorder` event becomes `dropInto` (below); a `select` event marks the task
read after `READ_AFTER_MS` (1.6 s, about 2 s with Toolbelt's 400 ms settle) unless another selection comes first. Required capabilities are `ui.core`, `ui.action-key`, `lifecycle`, `ui.split-action` (the
Snooze menu), `ui.rich-fields`, `ui.row-select`, `ui.row-reorder`, `ui.modifier-keys` and
`ui.timeline` (update timelines), `ui.row-pane` (the editable details drawer), `ui.composer`
(update boxes, the quick view's New task line and its Add update prompt), `assets` (state
icons), `ui.sub-sections` (Progressing), `ui.toast-key` (⌘Z for Undo), `ui.options-field` (label
values), `ui.nested-sections` (grouping levels, the dimmed Archived group), `ui.filter-group` (the filter
row), `ui.row-tree` (subtask rows, context rows, drops onto tasks), `ui.choice-control` (the
Subtasks menu), `ui.context-select` (context rows act as their task), `ui.section-pill` (label
groups as pills), `ui.row-dot` (the overdue dot), `ui.pane-buttons` (the drawer's buttons),
`ui.tag-multiple` (the Related field), `ui.heading-note` (the id above the drawer's name),
`ui.cell-prefix` (the id pill before a task's name), `ui.list-open` (the drawer's relation
lists) and `ui.tag-open` (a Related pill's task is a link; on Toolbelt 0.3.22 and later its
relation opens the picker). Optional `ui.list-inset` indents the relation lists, whose items
have no icon. The package is portable JavaScript, uses SDK 0.3.17 and needs Toolbelt 0.3.20 or
newer.

### Subtasks

A task's parent is the first Parent relation it holds (`parentOf`); `setParent` replaces it,
refusing cycles. `data.subtasks` (`off`, `own`, `parent`) comes from the `subtasks` choice
control. With subtasks on, `display.forest` turns each group's tasks into a tree: a task under its
parent, and a parent that isn't in the group as a context node, up to the top. Rows nest as
`Row.children` (started open); a context row is `c<task>@<group>` with `context: "<task>"` and
the task's own row (cells, actions, targets, pane) with its state pill always shown. The table's
`contextSelect` lets it be selected and makes its events name the task. Following their parent, `placement` puts each shown task in its
top parent's group (`groupTasks` reads that task's values). Parents carry a `settled/total` tag. `indent` (⌥→, its `targets` the task above) and
`outdent` (⌥←) set the parent; a `reorder` with `onto` (the table's `reorderOnto`) does too. Each
offers Undo.

### Filters and grouping

`data.filters` is the toolbar's filter row in order: `{id, group, selected}` for `status`, `due`
and `label:<id>`, grouping ones first. `src/display.ts` (pure) owns it: `normalizeFilters` keeps
it in step with the labels (run on load and after every event), `setSelection` and `arrange`
apply `filter` and `filter-arrange` events, and `arrange` refuses more than `MAX_LEVELS` (10)
levels, Status counting two for Progressing. `ui.ts` sends each filter with faceted counts (the
search and the other filters applied), `groupDisabled` once it couldn't fit, and Status's
`default` (Ongoing: every state but archived). Filter values are Status values (the six states
and `archived`), Due buckets (`overdue` open tasks past due, `today`, `next6`, `later`, `past`
finished tasks, `none`; `dueBucket`) and label values, with `__none` for no value and `yes` for a
yes/no label. Filter events save the data but don't withdraw a standing Undo, and Undo keeps the
current filter row.

`groupTasks` nests the shown tasks (`tableOrder`: each state's order, then archived newest
first) by the grouping filters. A section's id is its path of segments joined by `/`: a Status
value as is (`inbox`; Progressing's states don't include `progressing`), `d=<bucket>` for Due and
`l<id>=<value>` (URI-encoded) for a label. Only groups with tasks are declared, except each
selected state at the top of a Status grouping (Stalled only while stalling is on). `LOOKS` in `ui.ts` gives each group its label,
icon, collapsed/muted state and drop behavior. `dropTarget` reads a drop's section id back into
values; `dropInto` in `plugin.ts` sets labels and the due date (only Today or No date can be
set; other Due groups refuse), then archives (onto Archived), unarchives (out of it) and makes the
state move through `moveTo`, or reorders within the task's own Inbox or Working on. One Undo
covers the drop. The timer redraws once the day changes, so Due groups move on at midnight.

A row's pills (`rowTags`) leave out what its group's header says (`groupSays`, the group's id
read back through `dropTarget`; nested rows use their top row's group): its state pill
(`stateTag`, Archived for an archived task, which then needs no archive mark) shows unless the
group names that state, and a label's pill unless the group names that value.

Each task row carries a `pane` (`taskPane` in `src/ui.ts`): an inline form `task` (name as the
heading with the id as its `note`, status, due, labels, related, description), a facts line when
archived or worked, the created/changed line and an Updates section with the `update` composer
and an editable `updates` timeline. The row's actions show as buttons below (`paneButtons`), in
their groups: flow, edit, order, other, then danger (Delete). Pane events carry
`rowId`; `editInPlace` in `src/plugin.ts` applies form fields (status runs the lifecycle; Snooze
opens the snooze dialog; `related` goes to `editRelations`), `add-update` with `text` adds an update, and `edit-update-text` edits
one. The table's `enter` is `add-update`, whose `focus` is the composer; `edit` focuses the name.
Both open their dialogs when the host sends them instead (the window too narrow for the drawer).

The Related field (`related`, in the drawer and the New task dialog) is a `tags` field whose keys
are the relation types and their inverses (`~<type>`), `multiple` except Parent, and whose values
are tasks as `#<id> <name>` (`relatedKeys`, `relatedEntries`, `relatedId`). `editRelations`
diffs it: relations it no longer shows are removed (from whichever task holds them), new ones
are made, one Undo for the change. `relate` focuses it (`focus: "related"`); the Relate dialog
remains for narrow windows. In the drawer its `open` (`open-related`) follows a pill.

`BUILT_IN_RELATIONS` in `src/model.ts` names the relation types code relies on: `parent`
(subtasks: `parentOf`, `setParent`, `forest`, the settled count, "All subtasks are settled") and
`blocks` (`afterSettle` unblocking). `deleteRelationType` refuses them, Settings offers them
only Edit, and `parseData` adds back one that's missing. The drawer's `familyCards` list them
(Parent, Children, Blocked by, Blocks) as `list`s whose items are `rel:<id>` with the task's
state, id, labels, due date and dots; their `open` (`open-task`) and `open-related` both select
the task's row (or a context row standing for it) with `navigate`, or say it's hidden by the
search or filters. New task's dialog state carries `start` (`NewTaskStart`: the Workflow
state and Related values); saving adds the task, relates it, then moves it (Snoozed and Watching
open their dialog on the new task).

The Updates dialog (id `updates`, view state `{kind: "updates", id, draft, editing?}`) shows a
composer form (`update-new`) or the update being edited (`update-edit`) above a `timeline` of
the task's updates. The composer's field id is `text-<nextUpdateId>`, so after each added update
it mounts fresh, empty and focused (`autofocus`). Timeline actions arrive with
`{timeline, entryId}`; in the drawer they carry `rowId` instead of a dialog. The dialog remains
for narrow windows and for Change times…, which opens it on one update (`closeAfter`).

A stalled task's Updates dialog has `resume`: titled *Next step*, it closes once the update is
added, and that update brings the task back to Working on. `moveTo` opens it for a stalled
task moving to Working on (a drag, the drawer's Status), as do `add-update` without text and
`resume` when the host sends them.

The Watch dialog (id `watch`, view state `WatchDialog`: `on`, a `repeat` id from `REPEATS`,
`next` as a local datetime and `nextSet`) opens from `watch` and the drawer's
Status. Until the person picks `next`, changing `repeat` moves it to the default for that
cadence. Saving it offers Undo.

### The state machine

`TRANSITIONS` in `src/lifecycle.ts` lists every state a task can move to from each state, and
`transition(data, id, to, options, now)` is the only code that changes `state`. It refuses a
move the table doesn't allow, or any move of an archived task, with `refusal`'s message (which
names the key that helps), then applies the move's effects: work sessions, unread with a reason
for every move into the Inbox, the watch bookkeeping (`watchInto`), the snooze time, settling and
its relations, and order. The clock (`tick`) and drags (`drop`) call it too.

Each move has one action id, and `actionsFor` derives a row's moves from the table
(`actionFor`): P is `work` from the Inbox and, back to the Inbox, `done` (Working on), `unstall`
(Stalled), `wake` (Snoozed), `unwatch` (Watching) and `reopen` (Settled); ⇧P `stall` (only while
stalling is on), Z `snooze`, W `watch`, S `settle`. Stalled → Working on is `resume` (Write the
next step, `focus: "update"`): it lands in the drawer's update box, and the update brings the
task back. In the plugin, every entry point (row actions, drags, the drawer's Status, the quick
view) goes through `moveTo`: Snoozed and Watching open their dialog (from the quick view, in the
main window), whose save is the `transition`, and a stalled task going to Working on opens its
Next step box; other states are a `transition` at once. The drawer's
Status offers only the states the table allows from where the task is. Other row keys: A
archive/unarchive (a flag, not a state), E edit, ⇧U add update, R relate, U read/unread. Actions
sharing a key never appear on the same row.

`watch` on a task a check-in brought back (it still has `watch` but isn't in Watching) opens the
Watch dialog in check-in mode (`checkIn`): the next date from `nextOnSchedule` and a `note`.
Saving moves it to Watching, which counts the check and logs it as an update. From the quick view,
`watch` also calls `navigate("tasks", {select})` (optional `navigate` capability) so the dialog
shows in the main window. A drop into Watching of such a task opens the same dialog.

The quick view is a `stack`: a one-line `quick-task` composer (N) that adds to the Inbox, then the
`focus` list (Inbox, then Working on, then Stalled, in table order; each item's `icon` is its state's from `STATE_ICONS`, the one icon per state and group that headers, drop targets and the When column also use; and
its only `dot` and its red `titleStyle` mark overdue), whose items offer `add-update` with `input` (U), `snooze:tomorrow` (Z),
`watch` (W, on tasks back from a check-in; opens the main window), Z also on tasks being worked
on, and the lifecycle actions. A stalled task offers `add-update` (U, its next step), `unstall`
(P), Z and S.

### Stalling

`data.stall` (`StallSettings`: `on`, `after`, `warnAfter`, `remindEvery`, `at`, `weekends`) is
edited by Settings' Stalling card, a form `stall` whose fields save one at a time through
`setStall`, which checks them together (`after` 2–30, `warnAfter` 1 to `after` − 1,
`remindEvery` 0–30 with 0 for never, `at` 0–23). `parseData` repairs damaged settings to their
defaults (`DEFAULT_STALL`: on, 3, 2, 1, 9, true).

A task's `touched` is its last real work. `model.ts` sets it when an update is added or its text
edited, when the name, description or due date changes (`updateTask`) and when it gets a
subtask (`relate`, `setParent`); `lifecycle.ts` when it moves into Working on and when one of
its subtasks settles. Labels, relations, order and reading don't touch it.

Days are counted on the local calendar (`daysSince`, `daysAfter`), weekdays only without
`weekends`. `stallsAt` is `after` counted days after `touched`'s day, at `at` o'clock;
`stallWarning` (the amber When cell and the drawer's line) holds from `warnAfter` counted days;
`remindsAt` is `remindEvery` counted days after `remindedAt`. `tick` stalls a task whose time
came (unread, `stallReason`), reminds (unread again, `reminderReason`, `remindedAt` moves on)
and first runs `resumeTouched`: a stalled task touched after `stalledAt` goes back to the top of
Working on. The plugin runs `resumeTouched` after each event too, to toast it. `nextWake`
includes stall and reminder times.

## Code ownership

| Location | Responsibility |
| --- | --- |
| `src/model.ts` | Types, seed data, validation, task/label/relation operations, schema upgrade. No I/O. |
| `src/lifecycle.ts` | The state machine (`TRANSITIONS`, `transition`), sections, ordering, drag moves, unread rules and the clock (`tick`). No I/O. |
| `src/store.ts` | Loads and atomically saves `ontrack.json` (temporary file, then rename). |
| `src/display.ts` | The filter row: normalizing, selections and arrangement, where a task falls (status, due bucket, label value), the grouped sections and drop targets. No I/O. |
| `src/ui.ts` | Pure tree builders for both screens, dialogs and the quick view. |
| `assets/` | The state icons (`state-*.svg`), declared under `assets` in the manifest and copied into the package by `scripts/build.ts`. Monochrome: they use `currentColor`, so Toolbelt tints them with the text color. |
| `src/plugin.ts` | SDK lifecycle, event dispatch, Undo and the wake timer; saves after each change. |
| `src/index.ts` | Production entry: binds the plugin to `dataDir()`. |
| `src/migrate.ts` | Seeds a fresh install and upgrades schema 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8. |
| `scripts/` | Build, package and clean-archive verification. |

## Data

Schema 8 is one JSON document: `nextTaskId`, `nextLabelId`, `nextUpdateId`, `tasks`, `labels`,
`relationTypes`, `order` (`inbox`, `working`: task ids in the person's order), `filters` (the
filter row, above), `subtasks` (how subtasks show) and `stall` (stalling settings, above). IDs
are never reused. A task's `updates` are `{id, added, updated, text}` (epoch ms, Markdown) in
the order written; they are shown newest first by `added`. Adding, editing or deleting one
changes the task's `updated`.
A task's `labels` maps label id to its value (`true` for yes/no labels). A text label's `values`
are `{text, color}`: the one list of its values, and every value a task carries is in it. With
`freeform`, a task saved with a new value adds it (`rememberValues`); without, other values are
refused. Each value's color is picked when it's added (`leastUsedHue` from the SDK) and kept;
`valueColors: true` draws values in their own colors instead of the label's. Without it, the
optional `shades` (`strongest-first` or `lightest-first`) gives values a `Tag.shade` in list order.
The label editor sends values as `{text, color, from}`: `from` (the text when the editor opened)
makes a changed text a rename, applied to tasks; renaming onto another value merges them, and
tasks whose value left the list lose it. `due` is a local
wall-clock string, `YYYY-MM-DD` or `YYYY-MM-DDTHH:MM`, deliberately without a time zone. A relation
`{task, type}` is stored on one task and read from both sides through the relation type's `name`
and `inverse`.

Each task has `state` (`inbox`, `working`, `stalled`, `snoozed`, `watching`, `settled`),
`archived` with `archivedAt`, `unread` with `unreadReason`, `snoozedUntil`, `watch`, `settledAt`,
`touched`, `stalledAt` and `remindedAt` (while stalled), `stalls` (how many times it stalled,
kept), `dueAnnounced` (the due value already
announced, so it's announced once) and `sessions` (`{start, end?, by}`; `by` is `"me"` today and
leaves room for an agent). A task's section is its `state` (`sectionOf`); there is
no pinning (a yes/no label does that job). Snoozing, watching and stalling keep a task's
Inbox/Working position; stalling ends the work session, and archiving a stalled task puts it in
the Inbox.

`watch` is `{on?, since, every?, anchor?, next?, checked?, checks}`: who it waits on, when watching
started, an optional cadence `{n, unit: "day" | "week" | "month"}`, the first check-in of the
current schedule, the next check-in, the last check and how many there were. Repeats are
`anchor` plus whole cadences on the local calendar (`addCadence`, month ends clamp), so the day
and time never drift. No `next` means no reminders. A check-in moves the task to the Inbox but
keeps `watch`, so watching it again is that check (counted, logged as an update); moving to Working on or Settled, or P from Watching,
deletes it. When a move into Watching gets a date on the old schedule (same cadence), it keeps `anchor`; any
other date becomes the new `anchor`.

The clock: `tick(now)` brings touched stalled tasks back to Working on, wakes snoozes that ended (unread, "Snooze ended"), brings watched tasks
whose check-in came due to the top of the Inbox (unread, with `checkInReason`: who, how long, the
last check, the cadence), wakes snoozed and watched tasks whose due date arrived and marks open tasks unread when their due date arrives ("Due now"), then stalls tasks left
untouched and reminds of stalled ones (see [Stalling](#stalling)).
Settling marks tasks it blocked unread once nothing else blocks them, and a parent unread once
all its children are settled. Nothing settles automatically. In active mode a timer runs `tick` at
the next wake time or at least every minute; every event runs it too. Probe mode starts no timer.

Each event works on a clone of the data; a rejected change (`InvalidInput`) restores it and shows
the message in the open dialog or a toast. Every state move (`moveTo`, or saving the Snooze and
Watch dialogs, or a Snooze menu time), archive, and every removal (task, update, relation, label,
relation type) keep the previous data for `UNDO_MS` (eight seconds, Toolbelt's toast with a
button) behind the toast's Undo button. The toast's payload carries a token; `undo` accepts only
the latest token. Any later data change, including a clock tick, withdraws the Undo so restoring
can't discard it, except `select` marking a task read, which is copied into the snapshot instead. Successful changes are written
before the event returns, so `prepare` is always ready. Migration upgrades schema 1 (tasks whose
Status was Done become settled; the rest go to the Inbox in ID order) and schema 2 (every task
gets an empty `updates` list and `nextUpdateId` starts at 1) and schema 3 (no task is watched yet;
`pinned` and `order.pinned` are dropped, and pinned tasks get a yes/no "Pinned" label, made, or
reused when one of that name exists, only if some task was pinned) and schema 4 (a text label's
values become `{text, color}` with colors it uses least, and values tasks typed into a free-text
label join its list, A–Z, after the listed ones; labels keep showing one color) and schema 5 (the
filter row starts as the list looked: Status grouping and showing Ongoing, then Due and each
label; archived tasks get `archivedAt` from `updated`) and schema 6 (`subtasks` starts `off`)
and schema 7 (`stall` starts with its defaults; a task in Working on gets `touched` from its
latest work session or update, `lastWork`; a Status filter showing Working on shows Stalled too).

## Tests

`test/model.test.ts` covers the rules, `test/lifecycle.test.ts` the sections, transitions,
ordering, drops and clock, `test/plugin.test.ts` drives the real plugin through the
SDK's fake host, and `test/store.test.ts` covers persistence and the migration process.
`scripts/verify-package.ts` runs the built archive from an empty temporary folder.
