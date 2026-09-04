# Contributing

Requirements: Node 24+, Corepack, and Git.

```sh
corepack pnpm@11.20.0 install
corepack pnpm@11.20.0 run ci
```

Keep publishable packages renderer-independent and preserve the ownership boundaries in
[`docs/architecture.md`](docs/architecture.md). Add runtime tests for behavior, TSTyche tests for public inference, and a
Changeset for user-visible changes. Do not add placeholder packages for roadmap items.

Use `pnpm test` while developing and `pnpm test:run` for a non-watch run. `pnpm pack:check` builds, inspects, and
smoke-imports the router artifact.
