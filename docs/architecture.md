# OnTrack architecture

OnTrack owns its screens, data model, schema, migration, tests and release packages. Toolbelt owns
rendering, plugin installation, the runtime process and managed-data recovery.

## Runtime and UI

Toolbelt launches the bundled `index.js` with Bun. The plugin uses the public `@toolbelt/sdk`
package over JSON lines on stdin/stdout; stderr is diagnostic output. UI is a declarative tree;
Toolbelt keeps selection, typing and scroll. Dialog drafts, search, filters, sort and the
Open/All choice live in plugin memory and reset on restart.

The stable plugin id is `ontrack`. Screens are `tasks` (default, shortcut T) and `labels` (L),
plus the `quick` surface. Task row ids are the task id as a string on both the table and the quick
list, so selection hands off between them. Label rows are `l<id>`, relation type rows `r<id>`.
Required capabilities are `ui.core`, `ui.action-key` and `lifecycle`. The package is portable
JavaScript and needs Toolbelt 0.3.5 or newer for toolbar controls and column layout.

## Code ownership

| Location | Responsibility |
| --- | --- |
| `src/model.ts` | Types, seed data, validation and every data operation. No I/O. |
| `src/store.ts` | Loads and atomically saves `ontrack.json` (temporary file, then rename). |
| `src/ui.ts` | Pure tree builders for both screens, dialogs and the quick view. |
| `src/plugin.ts` | SDK lifecycle and event dispatch; saves after each data change. |
| `src/index.ts` | Production entry: binds the plugin to `dataDir()`. |
| `src/migrate.ts` | Schema 1 initialization: seeds labels and relation types once. |
| `scripts/` | Build, package and clean-archive verification. |

## Data

Schema 1 is one JSON document: `nextTaskId`, `nextLabelId`, `tasks`, `labels`, `relationTypes`.
IDs are never reused. A task's `labels` maps label id to its value (`true` for yes/no labels).
`due` is a local wall-clock string, `YYYY-MM-DD` or `YYYY-MM-DDTHH:MM`, deliberately without a
time zone. A relation `{task, type}` is stored on one task and read from both sides through the
relation type's `name` and `inverse`. Done means the label named Status has the value Done.

Each event works on a clone of the data; a rejected change (`InvalidInput`) restores it and shows
the message in the open dialog or a toast. Successful changes are written before the event
returns, so `prepare` is always ready. Schema changes need a new schema number, a retry-safe
migration and `data.supports` where older data stays readable.

## Tests

`test/model.test.ts` covers the rules, `test/plugin.test.ts` drives the real plugin through the
SDK's fake host, and `test/store.test.ts` covers persistence and the migration process.
`scripts/verify-package.ts` runs the built archive from an empty temporary folder.
