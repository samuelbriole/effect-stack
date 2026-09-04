# Agent guidance

Effect Stack is a family of independently adoptable, Effect-native application libraries. Preserve the architecture and quality bar as the project grows.

## Design

- Read [`docs/architecture.md`](docs/architecture.md) before changing ownership boundaries or dependency direction.
- Keep publishable core packages platform- and renderer-independent. Platform and renderer adapters depend on cores,
  never the reverse.
- Keep Router responsible for navigation, Query for remote resources, Form for editing and submission, and DB for
  normalized persistence.
- Prefer Effect-native semantics: typed failures, Schema at boundaries, scoped resources, interruption safety, services,
  Layers, Stream, and Atom where they fit the domain.
- Treat developer experience as a primary design constraint: strong inference, minimal ceremony, actionable failures, and
  consistent APIs across cores and adapters.
- Start roadmap domains as tested tracers. Publish a package or renderer adapter only after it earns a substantive API.
- Use domain-first package names under `@effect-stack/*`.

## Completion

- Add runtime tests for behavior and TSTyche tests for public type inference.
- Add a Changeset for user-visible changes to a published package.
- Run `corepack pnpm@11.20.0 run ci` and leave the package artifact checks passing.
