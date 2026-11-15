# toolbelt-ontrack — notes for coding agents

Read [README.md](README.md) and [docs/architecture.md](docs/architecture.md). Read
[docs/releases.md](docs/releases.md) before any version, tag or publication work. Keep these
documents accurate when behavior or contracts change; write maintenance references, not diaries.

## Workflow

- Never use the no-mistakes tool, plugin, skill or pipeline. Work directly.
- One agent per checkout. Stop and ask if unexpected edits appear.
- Never commit directly to `main`; use a branch and a PR and let CI pass. The user owns merges;
  merging a validated release PR authorizes its CI publication. Do not enable auto-merge unasked.
- Add user-visible changes to `## Unreleased` in `CHANGELOG.md`. Feature PRs do not bump
  versions; use a release PR.
- Pin workflow actions to full SHAs and keep permissions minimal. Allowed actions are
  GitHub-owned actions, `oven-sh/setup-bun` and `zizmorcore/zizmor-action`.

## Implementation and validation

- Use Bun commands, not node/npm/yarn/pnpm or other test runners. CI uses Bun 1.4.4.
- Depend on the pinned public SDK package. Do not copy SDK source or import a host checkout.
  New UI needs (editors, pickers) are host/SDK contracts: add them in the Toolbelt repo, wait for
  the SDK release, then pin it here with a matching `requires.host`.
- Keep `src/model.ts` free of I/O and `src/ui.ts` pure. Validate in the model, not the UI.
- Keep plugin/screen ids, row ids and the data schema stable. Schema changes need a migration.
- Run `bun run typecheck`, `bun test`, `bun run package` and `bun scripts/verify-package.ts`.
  Use the Toolbelt Plugin Tester with a disposable profile for visual and keyboard checks.

Follow the [release procedure](docs/releases.md). Local builds create files only. Published bytes
are immutable; corrections require a new version.
