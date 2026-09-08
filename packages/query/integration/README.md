# Query renderer integration tests

End-to-end lifecycle tests for `@effect-stack/query` against the official Atom
renderer bindings (`@effect/atom-react`, `@effect/atom-solid`, `@effect/atom-vue`)
in a DOM environment (`happy-dom`). All files are plain `.ts` — React uses
`createElement`, Solid uses `createComponent`, Vue uses `h` — so this project
needs no JSX/SFC transforms and never conflicts with the root Vitest project.

The scenarios are shared across frameworks (`shared/harness.ts`) and driven by
framework adapters (`shared/renderers.ts`). Coordination is strictly
Deferred/Queue-based plus bounded scheduler drains and renderer flush utilities
(`React.act`, `nextTick`); there are no time-based sleeps.

## Coverage

`react.test.ts` / `solid.test.ts` / `vue.test.ts` (same sequence each):

1. Two mounted `useAtomValue` observers on one resource share one load;
   pending/success transitions render in both; a positive registry-membership
   assertion pins observation to the scenario-provided `AtomRegistry`.
2. A `QueryAtom.mutation` observer renders `pending:1` while the invocation
   runs and `done:<result>` after success commits past the composed
   `resource.invalidate`; the invalidation revalidates once and is reflected in
   both query observers, which retain the previous success while stale
   (stale-while-revalidate), then render the new data.
3. `resource.snapshot` samples the same settled state through a fresh handle
   without starting work or retaining interest.
4. Unmounting the last observers releases the bruce interest and interrupts its
   unfinished load (loader request-scope finalizer observed) before any
   application scope closes.
5. Client-scope shutdown is the finalization barrier: a reader-only load and an
   accepted mutation both interrupt and run finalizers before the borrowed
   service built outside the client is released (`expectFinalizationBarrier`).
6. `family.invalidate` (Effect property) marks every instantiated input stale
   and schedules exactly one coalesced revalidation per observed input.

`renderer-lifecycle.test.ts` is a core-free sanity pass over the adapters
themselves (one registry node for two observers, refresh fan-out, subscription
release on unmount).

## Commands

```sh
# from the repository root
pnpm test:query-renderers
pnpm check
```

`pnpm test:run` includes this standalone Vitest project after the headless and Router suites. Root TypeScript checking also
includes the integration project, so both run as part of `pnpm ci`.
