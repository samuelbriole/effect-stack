/**
 * The single first-party query context for the React example. `createQueryContext`
 * is instantiated once with the app type; the boot wires children with
 * `<Provider value={app} registry={app.registry}>` (the registry stays
 * app-owned and is only borrowed, so core Router atoms and every query hook
 * share one registry), while components read the app with `useQueryContext()`.
 */
import type { QueryExampleApp } from "@effect-stack-example/query-shared"
import { createQueryContext } from "@effect-stack/query-react"

export const { Provider, useQueryContext } = createQueryContext<QueryExampleApp>()
