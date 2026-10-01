# EffectStack

Independently adoptable, Effect-native libraries with headless cores and first-party renderer adapters.
Inspired by [TanStack](https://tanstack.com/).

> EffectStack is an independent community project built on Effect. It is not maintained by Effectful Technologies Inc.

## Get started

Targets **Effect v4**.

```sh
pnpm add @effect-stack/router effect@4
```

Use the [adoption guide](docs/adoption.md) to choose a headless or renderer integration.

## Packages

| Package                                               | Status       |
| ----------------------------------------------------- | ------------ |
| [`@effect-stack/router`](packages/router)             | 🟢 Available |
| [`@effect-stack/router-react`](packages/router-react) | 🟢 Available |
| [`@effect-stack/router-solid`](packages/router-solid) | 🟢 Available |
| [`@effect-stack/router-vue`](packages/router-vue)     | 🟢 Available |
| `@effect-stack/form`                                  | 🟡 Planned   |
| `@effect-stack/db`                                    | 🔭 Exploring |

For remote state, use Effect Atom, Effect's alternative to TanStack Query.

[Navigation contracts](docs/router-navigation.md) ·
[Architecture](docs/architecture.md) · [Roadmap](docs/roadmap.md)

## Development

Use the pinned pnpm version through Corepack: `corepack pnpm install`, then `corepack pnpm run ci`.

Scheduler stays on 0.27 because `@effect/atom-react` requires `<0.28`. The Vue example keeps TypeScript 6 because
`vue-tsc` requires its JavaScript compiler API; the rest of the workspace uses TypeScript 7. Unstable-API lint
exceptions are scoped to the existing Effect Atom/URL integration files and their tests/examples; other code
continues to reject unstable APIs.
