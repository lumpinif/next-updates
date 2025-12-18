# Contributing

Thanks for helping improve `review-deps`!

## Ground Rules

- Be kind and constructive (see `CODE_OF_CONDUCT.md`).
- Keep changes focused and easy to review.
- Prefer evidence-driven behavior: every “recommendation” should have a reproducible command or a stable link behind it.

## Local Setup

Prereqs:

- Node.js >= 20
- pnpm (recommended for this repo)

Install and run:

```bash
pnpm install
pnpm test
pnpm build
```

Format/lint:

```bash
pnpm format
```

## Project Goals

This project aims to support Node.js projects using **npm / pnpm / Yarn / Bun**, with the same `package.json` but different lockfiles and package-manager commands.

When adding features, prefer:

- Lockfile detection first, then pick the matching command set
- Safe defaults (do not modify `package.json` / lockfiles unless explicitly requested)
- Clear UX: short terminal summary + optional structured outputs (prompt/json/md)

## Code Structure (CLI)

- `src/cli/prompts`: user interaction only (collect input; no “work”)
- `src/cli/tasks`: deterministic work (read files, run commands, parse outputs)
- `src/cli/flows`: orchestration (prompts + tasks + branching + error handling)
- `src/cli/ui`: UI adapter (Clack wrapper; keeps flows testable)

## Pull Requests

Before opening a PR:

- Run `pnpm test`
- Run `pnpm format`
- Update docs if behavior/flags change
