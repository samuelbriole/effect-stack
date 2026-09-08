import { createApp } from "@effect-stack-example/query-shared"
import { RegistryContext } from "@effect/atom-solid"
import { Effect, Fiber } from "effect"
import { render } from "solid-js/web"
import { App } from "./App.tsx"

/**
 * Boots the example the way a real SPA should: the application scope owns the
 * `QueryClient` and the Atom registry (both built by `createApp`), the Solid
 * tree mounts inside that scope, and teardown disposes Solid's root before the
 * registry and client scopes close.
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
                <RegistryContext.Provider value={app.registry}>
                  <App app={app} />
                </RegistryContext.Provider>
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
