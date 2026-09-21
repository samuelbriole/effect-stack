# EffectStack

Independently adoptable, Effect-native libraries with headless cores and first-party renderer adapters.
Inspired by [TanStack](https://tanstack.com/).

> EffectStack is an independent community project built on Effect. It is not maintained by Effectful Technologies Inc.

## Get started

Targets **Effect v4 RC**.

```sh
pnpm add @effect-stack/router effect@rc
```

Use the [adoption guide](docs/adoption.md) to choose a headless or renderer integration.

## Packages

| Package                                               | Status             |
| ----------------------------------------------------- | ------------------ |
| [`@effect-stack/router`](packages/router)             | 🟢 Available       |
| [`@effect-stack/router-react`](packages/router-react) | 🧪 Initial adapter |
| [`@effect-stack/router-solid`](packages/router-solid) | 🧪 Initial adapter |
| [`@effect-stack/router-vue`](packages/router-vue)     | 🧪 Initial adapter |
| `@effect-stack/form`                                  | 🟡 Planned         |
| `@effect-stack/db`                                    | 🔭 Exploring       |

For remote state, use Effect Atom, Effect's alternative to TanStack Query.

[Navigation contracts](docs/router-navigation.md) ·
[Architecture](docs/architecture.md) · [Roadmap](docs/roadmap.md)

Contributor setup and validation commands: [Development tooling](docs/development.md).
