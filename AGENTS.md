# Agent guidance

EffectStack contains independently adoptable, Effect-native libraries under `@effect-stack/*`.

## Design

- Follow [architecture and ownership](docs/architecture.md); adapters depend on platform-independent cores.
- Preserve [navigation contracts](docs/router-navigation.md) when changing Router or its adapters.
- Use typed Effect failures, Schema at boundaries, scoped resources, and interruption-safe cleanup. Supply dependencies
  through services and Layers; preserve public inference and native renderer behavior.
- Start new domains with a tested end-to-end slice. Publish packages only when they provide a substantive API.

## Documentation

- Keep package READMEs focused on setup and package-specific APIs. Link to shared contracts instead of repeating them.
- Update examples and API documentation with API changes. Keep agent instructions actionable; put review logs and
  validation results in PRs. Preserve released changelogs; write concise, consumer-facing Changesets.

## Completion

- Add or update runtime tests for changed behavior and TSTyche tests for changed public inference.
- Add a Changeset for release-worthy changes to published packages; documentation-only edits need no version bump.
- Run `corepack pnpm@12.5.1 run ci` and leave the package artifact checks passing.
