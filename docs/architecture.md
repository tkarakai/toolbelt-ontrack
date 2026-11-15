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
The Tasks table declares `appearance: "document"`, `sections` (pinned, inbox, working, snoozed,
settled), `reorder` and `selectEvents`; New task has key N. Settings wraps each table in a card
whose action creates its kind of row. A `reorder` event becomes a lifecycle transition; a `select` event marks the task
read. Required capabilities are `ui.core`, `ui.action-key`, `lifecycle`, `ui.split-action` (the
Snooze menu), `ui.rich-fields`, `ui.row-select`, `ui.row-reorder` and `ui.modifier-keys`. The
package is portable JavaScript, uses SDK 0.3.6 and needs Toolbelt 0.3.10 or newer.

## Code ownership

| Location | Responsibility |
| --- | --- |
| `src/model.ts` | Types, seed data, validation, task/label/relation operations, schema upgrade. No I/O. |
| `src/lifecycle.ts` | Sections, transitions, ordering, drag moves, unread rules and the clock (`tick`). No I/O. |
| `src/store.ts` | Loads and atomically saves `ontrack.json` (temporary file, then rename). |
| `src/ui.ts` | Pure tree builders for both screens, dialogs and the quick view. |
| `src/plugin.ts` | SDK lifecycle, event dispatch, Undo and the wake timer; saves after each change. |
| `src/index.ts` | Production entry: binds the plugin to `dataDir()`. |
| `src/migrate.ts` | Seeds a fresh install and upgrades schema 1 to 2. |
| `scripts/` | Build, package and clean-archive verification. |

## Data

Schema 2 is one JSON document: `nextTaskId`, `nextLabelId`, `tasks`, `labels`, `relationTypes`
and `order` (`pinned`, `inbox`, `working`: task ids in the person's order). IDs are never reused.
A task's `labels` maps label id to its value (`true` for yes/no labels). A label's optional
`shades` (`strongest-first` or `lightest-first`) gives its listed values a `Tag.shade` in list
order; absent means one color. It is additive, so schema 2 still holds and older versions keep it. `due` is a local
wall-clock string, `YYYY-MM-DD` or `YYYY-MM-DDTHH:MM`, deliberately without a time zone. A relation
`{task, type}` is stored on one task and read from both sides through the relation type's `name`
and `inverse`.

Each task has `state` (`inbox`, `working`, `snoozed`, `settled`), `pinned`, `archived`, `unread`
with `unreadReason`, `snoozedUntil`, `settledAt`, `dueAnnounced` (the due value already
announced, so it's announced once) and `sessions` (`{start, end?, by}`; `by` is `"me"` today and
leaves room for an agent). The section a task shows in follows from these: settled, then snoozed,
then pinned, then working or inbox. Pinning and snoozing keep a task's Inbox/Working position.

The clock: `tick(now)` wakes snoozes that ended (unread, "Snooze ended"), wakes snoozed tasks
whose due date arrived and marks open tasks unread when their due date arrives ("Due now").
Settling marks tasks it blocked unread once nothing else blocks them, and a parent unread once
all its children are settled. Nothing settles automatically. In active mode a timer runs `tick` at
the next wake time or at least every minute; every event runs it too. Probe mode starts no timer.

Each event works on a clone of the data; a rejected change (`InvalidInput`) restores it and shows
the message in the open dialog or a toast. Settle, snooze, unpin, archive and delete keep the
previous data for five seconds behind the toast's Undo button. Successful changes are written
before the event returns, so `prepare` is always ready. Migration upgrades schema 1 (tasks whose
Status was Done become settled; the rest go to the Inbox in ID order).

## Tests

`test/model.test.ts` covers the rules, `test/lifecycle.test.ts` the sections, transitions,
ordering, drops and clock, `test/plugin.test.ts` drives the real plugin through the
SDK's fake host, and `test/store.test.ts` covers persistence and the migration process.
`scripts/verify-package.ts` runs the built archive from an empty temporary folder.
