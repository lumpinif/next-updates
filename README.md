# next-updates

Evidence-driven dependency upgrade assistant for Node.js projects.

## What it is

`next-updates` scans your project, collects reproducible evidence (versions, dependency graph context, security advisories, diffs/links), and outputs a concise “task card” you can paste into any AI (or just read yourself) to decide what to upgrade first.

Design goals:

- Zero config, one command
- Evidence > vibes (every recommendation should come with “how to reproduce”)
- Safe by default (doesn’t edit `package.json` / lockfiles unless you explicitly opt in)
- Works for monorepos and workspaces

## Package manager support

Target support (same `package.json`, different ecosystems):

- npm (`package-lock.json`)
- pnpm (`pnpm-lock.yaml`)
- Yarn (`yarn.lock`)
- Bun (`bun.lock`, `bun.lockb`)

Status: this repo is currently **early scaffolding** (you can see the Clack UI), and the multi-package-manager pipeline is still being implemented.

## Usage

Once published to npm:

- `npx next-updates@latest`
- `pnpm dlx next-updates@latest`
- `yarn dlx next-updates@latest`
- `bunx next-updates@latest`

Local dev (this repository):

- `pnpm install`
- `pnpm build`
- `node dist/bin.mjs`

## Output (JSON)

- `packages` groups by `package.json` path, then dependency type, then package name.
- Each package includes `current` and `target` (range + version), `versionWindow.delta`, and `evidence.links`.
- `evidence.links` is best-effort and only includes reachable entries.
- `evidence.links.compare`: GitHub compare URL when tags resolve.
- `evidence.links.npmDiffLink`: registry diff command.
- `evidence.links.releases`: GitHub releases list.
- `evidence.links.changelog`: raw changelog file.

## Docs

- Product/tech design: `dev-spec/next-updates-prep.md`

## Contributing

See `CONTRIBUTING.md`.

## License

MIT. See `LICENSE`.

## Development

- Install dependencies:

```bash
pnpm install
```

- Run the unit tests:

```bash
pnpm test
```

- Build the library:

```bash
pnpm build
```

- Format code:

```bash
pnpm format
```
