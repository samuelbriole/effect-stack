/**
 * The single first-party query context for the Vue example. `createQueryContext`
 * is instantiated once with the app type; the boot wraps the tree with the
 * `Provider` (passing `value={app}` and `registry={app.registry}` — the registry
 * stays app-owned and is only borrowed, so Router state, stats, and every query
 * hook observe one registry), while components read the app with
 * `useQueryContext()` — a readonly `Ref<App>`, so provider value replacement
 * propagates honestly instead of freezing setup-time snapshots. Read
 * `app.value` inside reactive getters and event actions.
 */
import type { QueryExampleApp } from "@effect-stack-example/query-shared"
import { createQueryContext } from "@effect-stack/query-vue"

export const { Provider, useQueryContext } = createQueryContext<QueryExampleApp>()
