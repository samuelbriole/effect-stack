# Development tooling

Use the pnpm version pinned in `package.json`:

```sh
corepack pnpm@12.5.1 install --frozen-lockfile
pnpm lint
pnpm format
pnpm ci
```

## Formatting

Oxfmt formats source, examples, configuration, and documentation. `.oxfmtrc.json` preserves the project's two-space,
120-column, double-quote, no-semicolon style. Import and package key sorting are disabled. Generated output, the lockfile,
and released changelogs are excluded. `pnpm format` writes formatting; `pnpm lint` checks it. `pnpm lint-fix` runs Oxlint's
fixes before formatting.

## Type-aware linting

`.oxlintrc.json` enables type-aware Oxlint and the recommended `effecttsgo` preset from
[`@effect/tsgo`](https://github.com/Effect-TS/tsgo/blob/main/docs/README.md). This includes Effect correctness errors such as
unconsumed Effects and missing context, plus advisory Effect idiom warnings. Floating and misused promises are errors.
Warnings do not fail CI; errors do.

The integration uses a matched set of pinned versions: `@effect/tsgo` 0.45.0, Oxlint 1.82.0, and `oxlint-tsgolint` 7.0.2001.
Upgrade them together according to Effect's supported-version matrix. The `prepare` script patches Oxlint and its
type-aware engine. Both lint scripts also run this idempotent patch explicitly, because pnpm can skip lifecycle scripts
on an already-up-to-date installation. Run `pnpm prepare` to refresh the patch before invoking Oxlint directly from an
editor. TypeScript itself is not patched, so regular builds and the Vue example's TypeScript 6 tooling keep their existing
compiler behavior.

The configuration accounts for this library's implementation and compatibility tests:

- Generic route and renderer boundaries intentionally erase and restore types. General assertion bans and the Effect
  unknown-error-channel rule are disabled; Effect-specific unsafe assertions remain checked, with documented local
  exceptions for correlated route errors.
- Explicit type arguments, parameters, and assertions support public inference and tests across TypeScript versions, so
  redundant-type cleanup rules are disabled.
- Effect generators mix returned values with yielded non-returning effects, so `consistent-return` is disabled.
- Renderer tests use native async callbacks, promises, and timers; the corresponding Effect preference warnings are
  disabled in runtime and type tests.
- Schema error constructors only forward their unchanged schema fields while providing generic constructor inference.
  Their local lint exceptions document that requirement.

Run `pnpm ci` before submitting changes. It includes linting, TypeScript checks, runtime and inference tests, package and
example builds, and package artifact validation.
