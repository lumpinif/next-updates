# review-deps

Evidence-driven dependency upgrade assistant for Node.js projects.

## What it is

`review-deps` scans your project, collects reproducible evidence (versions, dependency graph context, security advisories, diffs/links), and outputs a concise “task card” you can paste into any AI (or just read yourself) to decide what to upgrade first.

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

- `npx review-deps@latest`
- `pnpm dlx review-deps@latest`
- `yarn dlx review-deps@latest`
- `bunx review-deps@latest`

Local dev (this repository):

- `pnpm install`
- `pnpm build`
- `node dist/bin.mjs`

## Docs

- Product/tech design: `dev-spec/review-deps-prep.md`

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
