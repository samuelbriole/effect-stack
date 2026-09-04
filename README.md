# Effect Web

Effect-native application infrastructure for the web, designed as independently adoptable headless packages.

The first and currently only publishable package is [`@effect-web/router`](packages/router): typed bidirectional routes,
Schema validation, browser and memory history, scoped lazy loading, last-navigation-wins interruption, and reactive state
through Effect Atom. The same route definitions power thin [React](examples/router-react) and
[Solid](examples/router-solid) tracers without renderer code entering the package.

> **Compatibility:** this bootstrap targets Effect `4.0.0-rc.112`. Because npm's default `effect` tag still selects v3,
> use explicit `@rc` installation commands while Effect v4 remains a release candidate.

## Ownership

- **Router** owns URL interpretation, matching, history, navigation, and navigation lifecycle state.
- Future **Query** owns remote-resource lifecycle and caching.
- Future **Form** owns editing, validation, and submission state.
- Future **DB** owns normalized entities, indexes, transactions, and live queries.

Atom is the cross-renderer observation mechanism, not a second owner. Lazy route modules provide code splitting only;
remote data remains Query's domain. Adopting Router never requires adopting future Effect Web modules.

## Documentation

- [Architecture and ownership](docs/architecture.md)
- [Incremental adoption](docs/adoption.md)
- [Roadmap](docs/roadmap.md)
- [`@effect-web/router` package guide](packages/router/README.md)
- [Contributing](CONTRIBUTING.md)

## Release prerequisites

Automation is ready for Changesets release PRs and npm provenance. Publishing remains externally blocked until the
repository owner confirms ownership of the `@effect-web` npm scope, configures this repository and
`.github/workflows/release.yml` as an npm trusted publisher, and protects `main` with the required quality checks.
