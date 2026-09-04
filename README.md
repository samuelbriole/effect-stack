# Effect Stack

Independently adoptable application infrastructure built natively on Effect, including universal core modules and
optional platform and renderer integrations.

> Effect Stack is an independent community project built on Effect. It is not maintained by the Effect organization.

The project currently ships [`@effect-stack/router`](packages/router), providing typed bidirectional routes, Schema
validation, browser and memory history, lazy route modules, interruption-safe navigation, and reactive state through
Effect Atom.

```sh
pnpm add @effect-stack/router effect@rc
```

> Effect Stack currently targets Effect `4.0.0-rc.112`. Use the explicit `effect@rc` tag while Effect v4 remains a release
> candidate.

The same headless route definitions power the included [React](examples/router-react),
[Solid](examples/router-solid), and [Vue](examples/router-vue) examples through their official Effect Atom adapters.

## Learn more

- [Router guide](packages/router/README.md)
- [Adoption guide](docs/adoption.md)
- [Architecture](docs/architecture.md)
- [Roadmap](docs/roadmap.md)
- [Contributing](CONTRIBUTING.md)
