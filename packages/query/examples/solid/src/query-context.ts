/**
 * The single first-party query context for the Solid example. `createQueryContext`
 * is instantiated once with the app type; the boot wraps the tree with
 * `<Provider value={app} registry={app.registry}>` (the registry stays
 * app-owned and is only borrowed, so Router state, stats, and every query hook
 * observe one registry), while components read the app reactively with
 * `useQueryContext()` — an `Accessor`, so provider value replacement propagates
 * without stale setup snapshots.
 */
import type { QueryExampleApp } from "@effect-stack-example/query-shared"
import { createQueryContext } from "@effect-stack/query-solid"

export const { Provider, useQueryContext } = createQueryContext<QueryExampleApp>()
