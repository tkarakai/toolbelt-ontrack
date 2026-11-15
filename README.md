# Toolbelt OnTrack

OnTrack is a simple, flexible task tracker for [Toolbelt](https://github.com/tkarakai/toolbelt).
You create and manage every task yourself; nothing is imported or synced.

## Use

In Toolbelt's plugin manager, enter `tkarakai/toolbelt-ontrack`, review the release and publisher,
and approve execution. Plugin code runs with your user privileges; process isolation is not a
security sandbox.

- **Tasks** lists your tasks with their labels as colored pills, due dates (overdue in red) and
  last update. Search matches names, descriptions and label values; each label is a toolbar
  filter. **Open** hides tasks whose Status is Done. Select a task to see its details, labels,
  related tasks and description in the drawer. **Edit** (E), **Relate to…** (R), **Remove
  relation** and **Delete** act on the selected task.
- **Labels** defines labels and relation types.
- The menu-bar quick view lists open tasks with a due date, soonest first. The plugin badge counts
  overdue open tasks.

### Tasks

A task has an automatic ID, a name, created and last-updated times, an optional due date with an
optional time (`2026-11-20` or `2026-11-20 14:30`, local time; a date alone is due at the end of
that day), a Markdown description, at most one value per label, and relations to other tasks.

### Labels

A label has a name, a color and a type:

- **Yes/no** labels are either on a task or not (isPersonal).
- **Lookup** labels pick one value from their list (Priority: High, Medium, Low).
- **Free text** labels accept any value; their list, if any, holds suggestions (Project).

A fresh install has Project, isPersonal, Priority and Status. The label's color is used for its
pills, filter dots and details. Narrowing a lookup list or deleting a label removes the values
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
