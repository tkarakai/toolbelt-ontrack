# OnTrack architecture

OnTrack owns its screens, data model, schema, migration, tests and release packages. Toolbelt owns
rendering, plugin installation, the runtime process and managed-data recovery.

## Runtime and UI

Toolbelt launches the bundled `index.js` with Bun. The plugin uses the public `@toolbelt/sdk`
package over JSON lines on stdin/stdout; stderr is diagnostic output. UI is a declarative tree;
Toolbelt keeps selection, typing, scroll and drag feedback. Dialog drafts, search, filters, the
Tasks/Archived choice and the Undo snapshot live in plugin memory and reset on restart.

The stable plugin id is `ontrack`. Screens are `tasks` (default, shortcut T) and `labels` (titled
Settings, shortcut S; the id stays `labels`),
plus the `quick` surface. Task row ids are the task id as a string on both the table and the quick
list, so selection hands off between them. Label rows are `l<id>`, relation type rows `r<id>`.
The Tasks table declares `appearance: "document"`, `sections` (pinned, inbox, working titled
Progressing, settled), `reorder` and `selectEvents`; New task has key N. Snoozed and Watching
rows use a group path inside Progressing (`["working", SUBGROUPS.snoozed]`), so they show as
groups after its own rows, Snoozed first. The host reports drops into those groups as `working`;
`dropSection` tells them apart from `before` (before a group's first row ends the group above,
`null` joins the last group shown). Saving a new task calls `navigate("tasks", {select})` so the
list lands on it (optional `navigate` capability). Settings wraps each table in a card
whose action creates its kind of row. A `reorder` event becomes a lifecycle transition; a `select` event marks the task
read. Required capabilities are `ui.core`, `ui.action-key`, `lifecycle`, `ui.split-action` (the
Snooze menu), `ui.rich-fields`, `ui.row-select`, `ui.row-reorder`, `ui.modifier-keys` and
`ui.timeline` (update timelines), `ui.row-pane` (the editable details drawer) and `ui.composer`
(update boxes, the quick view's New task line and its Add update prompt). The package is portable
JavaScript, uses SDK 0.3.8 and needs Toolbelt 0.3.12 or newer.

Each task row carries a `pane` (`taskPane` in `src/ui.ts`): an inline form `task` (name as the
heading, status, due, labels, description), a facts line, a Related section and an Updates
section with the `update` composer and an editable `updates` timeline. Pane events carry
`rowId`; `editInPlace` in `src/plugin.ts` applies form fields (status runs the lifecycle; Snooze
opens the snooze dialog), `add-update` with `text` adds an update, and `edit-update-text` edits
one. The table's `enter` is `add-update`, whose `focus` is the composer; `edit` focuses the name.
Both open their dialogs when the host sends them instead (the window too narrow for the drawer).

The Updates dialog (id `updates`, view state `{kind: "updates", id, draft, editing?}`) shows a
composer form (`update-new`) or the update being edited (`update-edit`) above a `timeline` of
the task's updates. The composer's field id is `text-<nextUpdateId>`, so after each added update
it mounts fresh, empty and focused (`autofocus`). Timeline actions arrive with
`{timeline, entryId}`; in the drawer they carry `rowId` instead of a dialog. The dialog remains
for narrow windows and for Change times…, which opens it on one update (`closeAfter`).

The Watch dialog (id `watch`, view state `WatchDialog`: `on`, a `repeat` id from `REPEATS`,
`next` as a local datetime and `nextSet`) opens from `watch`, `edit-watch` and the drawer's
Status. Until the person picks `next`, changing `repeat` moves it to the default for that
cadence. Saving it offers Undo.

Row keys: P start/done for now, S settle/un-settle, Z snooze/wake, W watch/change watch, ⇧W
stop watching, K still waiting (only on a task a check-in brought back), ⇧P pin/unpin, A
archive/unarchive, E edit, ⇧U add update, R relate, U read/unread. Paired actions share a key and
never appear on the same row.

`still-waiting` (K) always opens the Still waiting dialog (id `stillWaiting`, view state
`StillWaitingDialog`: `next`, `note`, the `proposed` check-in from `proposedCheck` and the
`upcoming` one from `upcomingCheck` when it hasn't come yet). From the quick view it also calls
`navigate("tasks", {select})` (optional `navigate` capability) so the dialog shows in the main
window; without it, a toast asks to open OnTrack. A drop into Watching of a task that's already
watched opens the same dialog. Saving calls `stillWaiting` with the date (`null` when cleared)
and offers Undo.

The quick view is a `stack`: a one-line `quick-task` composer (N) that adds to the Inbox, then the
`focus` list, whose items offer `add-update` with `input` (U), `snooze:tomorrow` (Z),
`still-waiting` (K, on watched tasks; opens the main window) and the lifecycle actions.

## Code ownership

| Location | Responsibility |
| --- | --- |
| `src/model.ts` | Types, seed data, validation, task/label/relation operations, schema upgrade. No I/O. |
| `src/lifecycle.ts` | Sections, transitions, ordering, drag moves, unread rules and the clock (`tick`). No I/O. |
| `src/store.ts` | Loads and atomically saves `ontrack.json` (temporary file, then rename). |
| `src/ui.ts` | Pure tree builders for both screens, dialogs and the quick view. |
| `src/plugin.ts` | SDK lifecycle, event dispatch, Undo and the wake timer; saves after each change. |
| `src/index.ts` | Production entry: binds the plugin to `dataDir()`. |
| `src/migrate.ts` | Seeds a fresh install and upgrades schema 1 → 2 → 3 → 4. |
| `scripts/` | Build, package and clean-archive verification. |

## Data

Schema 4 is one JSON document: `nextTaskId`, `nextLabelId`, `nextUpdateId`, `tasks`, `labels`,
`relationTypes` and `order` (`pinned`, `inbox`, `working`: task ids in the person's order). IDs
are never reused. A task's `updates` are `{id, added, updated, text}` (epoch ms, Markdown) in
the order written; they are shown newest first by `added`. Adding, editing or deleting one
changes the task's `updated`.
A task's `labels` maps label id to its value (`true` for yes/no labels). A label's optional
`shades` (`strongest-first` or `lightest-first`) gives its listed values a `Tag.shade` in list
order; absent means one color. It was added within schema 2 and older versions keep it. `due` is a local
wall-clock string, `YYYY-MM-DD` or `YYYY-MM-DDTHH:MM`, deliberately without a time zone. A relation
`{task, type}` is stored on one task and read from both sides through the relation type's `name`
and `inverse`.

Each task has `state` (`inbox`, `working`, `snoozed`, `watching`, `settled`), `pinned`, `archived`,
`unread` with `unreadReason`, `snoozedUntil`, `watch`, `settledAt`, `dueAnnounced` (the due value already
announced, so it's announced once) and `sessions` (`{start, end?, by}`; `by` is `"me"` today and
leaves room for an agent). A task's home section is its `state` (`sectionOf`). `pinned` is a
flag on top: Pinned (`inSection(data, "pinned")`) lists every pinned, unarchived task in
`order.pinned`, and each also shows at home. Its row in Pinned has the id `p<id>` (the home row
keeps the plain id), group `pinned`, a mark and a chip naming the home (`HOMES`), and `up`/`down`
that move it within Pinned. Settling keeps the pin; archiving removes it. Drops into or out of
Pinned are refused (`drop(..., fromPinned)`); drops within it reorder `order.pinned`. Snoozing
and watching keep a task's Inbox/Working position.

`watch` is `{on?, since, every?, anchor?, next?, checked?, checks}`: who it waits on, when watching
started, an optional cadence `{n, unit: "day" | "week" | "month"}`, the first check-in of the
current schedule, the next check-in, the last Still waiting and how many there were. Repeats are
`anchor` plus whole cadences on the local calendar (`addCadence`, month ends clamp), so the day
and time never drift. No `next` means no reminders. A check-in moves the task to the Inbox but
keeps `watch`, so Still waiting can send it back; `startWorking`, `settle` and `stopWatching`
delete it. `stillWaiting` takes the confirmed date: one on the anchor's schedule keeps `anchor`,
any other becomes the new `anchor`, and `null` removes `next`, `anchor` and `every`.

The clock: `tick(now)` wakes snoozes that ended (unread, "Snooze ended"), brings watched tasks
whose check-in came due to the top of the Inbox (unread, with `checkInReason`: who, how long, the
last check, the cadence), wakes snoozed and watched tasks whose due date arrived and marks open tasks unread when their due date arrives ("Due now").
Settling marks tasks it blocked unread once nothing else blocks them, and a parent unread once
all its children are settled. Nothing settles automatically. In active mode a timer runs `tick` at
the next wake time or at least every minute; every event runs it too. Probe mode starts no timer.

Each event works on a clone of the data; a rejected change (`InvalidInput`) restores it and shows
the message in the open dialog or a toast. Settle, snooze, unpin, archive, delete and deleting an update keep
the previous data for five seconds behind the toast's Undo button. Successful changes are written
before the event returns, so `prepare` is always ready. Migration upgrades schema 1 (tasks whose
Status was Done become settled; the rest go to the Inbox in ID order) and schema 2 (every task
gets an empty `updates` list and `nextUpdateId` starts at 1) and schema 3 (only the schema number
changes; no task is watched yet).

## Tests

`test/model.test.ts` covers the rules, `test/lifecycle.test.ts` the sections, transitions,
ordering, drops and clock, `test/plugin.test.ts` drives the real plugin through the
SDK's fake host, and `test/store.test.ts` covers persistence and the migration process.
`scripts/verify-package.ts` runs the built archive from an empty temporary folder.
