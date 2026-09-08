import { createApp } from "@effect-stack-example/query-shared"
import { Effect, Fiber } from "effect"
import { render } from "solid-js/web"
import { App } from "./App.tsx"
import { Provider } from "./query-context.ts"

/**
 * Boots the example the way a real SPA should: the application scope owns the
 * `QueryClient` and the Atom registry (both built by `createApp`), the Solid
 * tree mounts inside that scope through the first-party query context
 * `Provider` — which borrows `app.registry`, so Router state, stats, and every
 * query hook observe one registry — and teardown disposes Solid's root before
 * the registry is disposed and the client scope closes.
 */
export const startExample = (container: HTMLElement): () => void => {
  const fiber = Effect.runFork(
    Effect.scoped(
      Effect.gen(function*() {
        const app = yield* createApp()
        yield* Effect.acquireRelease(
          Effect.sync(() =>
            render(
              () => (
                <Provider value={app} registry={app.registry}>
                  <App />
                </Provider>
              ),
              container
            )
          ),
          (dispose) => Effect.sync(dispose)
        )
        yield* Effect.never
      })
    )
  )
  return () => {
    Effect.runPromise(Fiber.interrupt(fiber)).catch(() => undefined)
  }
}
