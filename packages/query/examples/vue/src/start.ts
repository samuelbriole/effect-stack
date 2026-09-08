import { createApp } from "@effect-stack-example/query-shared"
import { Effect, Fiber } from "effect"
import { createApp as createVueApp, h } from "vue"
import AppRoot from "./App.vue"
import { Provider } from "./query-context.ts"

/**
 * Boots the example the way a real SPA should: the application scope owns the
 * `QueryClient` and the Atom registry (both built by `createApp`), the Vue
 * tree mounts inside that scope under the first-party query context
 * `Provider` — which borrows `app.registry`, so Router state, stats, and every
 * query hook observe one registry — and teardown unmounts the Vue app before
 * the registry is disposed and the client scope closes. Nothing is handed back
 * from a finished `Effect.scoped`, so the mounted UI never observes a closed
 * client.
 */
export const startExample = (container: HTMLElement): () => void => {
  const fiber = Effect.runFork(
    Effect.scoped(
      Effect.gen(function*() {
        const app = yield* createApp()
        yield* Effect.acquireRelease(
          Effect.sync(() => {
            const vueApp = createVueApp({
              render: () => h(Provider, { value: app, registry: app.registry }, { default: () => h(AppRoot) })
            })
            vueApp.mount(container)
            return vueApp
          }),
          (vueApp) => Effect.sync(() => vueApp.unmount())
        )
        yield* Effect.never
      })
    )
  )
  return () => {
    Effect.runPromise(Fiber.interrupt(fiber)).catch(() => undefined)
  }
}
