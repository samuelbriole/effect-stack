# Effect Web

Effect-native, renderer-independent application infrastructure for the web.

The project currently ships [`@effect-web/router`](packages/router), providing typed bidirectional routes, Schema
validation, browser and memory history, lazy route modules, interruption-safe navigation, and reactive state through
Effect Atom.

```sh
pnpm add @effect-web/router effect@rc
```

> Effect Web currently targets Effect `4.0.0-rc.112`. Use the explicit `effect@rc` tag while Effect v4 remains a release
> candidate.

The same headless route definitions power the included [React](examples/router-react) and
[Solid](examples/router-solid) examples through their official Effect Atom adapters.

## Learn more

- [Router guide](packages/router/README.md)
- [Adoption guide](docs/adoption.md)
- [Architecture](docs/architecture.md)
- [Roadmap](docs/roadmap.md)
- [Contributing](CONTRIBUTING.md)
