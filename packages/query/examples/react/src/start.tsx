import { createApp } from "@effect-stack-example/query-shared"
import { scheduleTask } from "@effect/atom-react"
import { Effect, Fiber } from "effect"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App.tsx"
import { Provider } from "./query-context.ts"

/**
 * Boots the example the way a real SPA should: the application scope owns the
 * `QueryClient` and the Atom registry (both built by `createApp`), the React
 * tree mounts inside that scope through the first-party query context
 * `Provider` — which borrows `app.registry`, so Router state, stats, and every
 * query hook observe one registry — and teardown unmounts the UI before the
 * registry is disposed and the client scope closes. Nothing is handed back
 * from a finished `Effect.scoped`, so the mounted UI never observes a closed
 * client.
 */
export const startExample = (container: HTMLElement, options?: { readonly strictMode?: boolean }): () => void => {
  const strictMode = options?.strictMode ?? true
  const fiber = Effect.runFork(
    Effect.scoped(
      Effect.gen(function*() {
        const app = yield* createApp({ scheduleTask })
        const root = createRoot(container)
        yield* Effect.acquireRelease(
          Effect.sync(() => {
            const tree = (
              <Provider value={app} registry={app.registry}>
                <App />
              </Provider>
            )
            root.render(strictMode ? <StrictMode>{tree}</StrictMode> : tree)
          }),
          () => Effect.sync(() => root.unmount())
        )
        yield* Effect.never
      })
    )
  )
  return () => {
    Effect.runPromise(Fiber.interrupt(fiber)).catch(() => undefined)
  }
}
