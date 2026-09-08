import { createApp } from "@effect-stack-example/query-shared"
import { RegistryContext, scheduleTask } from "@effect/atom-react"
import { Effect, Fiber } from "effect"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App.tsx"

/**
 * Boots the example the way a real SPA should: the application scope owns the
 * `QueryClient` and the Atom registry (both built by `createApp`), the React
 * tree mounts inside that scope, and teardown unmounts the UI before the
 * registry and client are disposed. Nothing is handed back from a finished
 * `Effect.scoped`, so the mounted UI never observes a closed client.
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
              <RegistryContext.Provider value={app.registry}>
                <App app={app} />
              </RegistryContext.Provider>
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
