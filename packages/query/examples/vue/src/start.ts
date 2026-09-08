import { createApp } from "@effect-stack-example/query-shared"
import { registryKey } from "@effect/atom-vue"
import { Effect, Fiber } from "effect"
import { createApp as createVueApp } from "vue"
import AppRoot from "./App.vue"

/**
 * Boots the example the way a real SPA should: the application scope owns the
 * `QueryClient` and the Atom registry (both built by `createApp`), the Vue
 * tree mounts inside that scope, and teardown unmounts the Vue app before the
 * registry and client scopes close. Nothing is handed back from a finished
 * `Effect.scoped`, so the mounted UI never observes a closed client.
 */
export const startExample = (container: HTMLElement): () => void => {
  const fiber = Effect.runFork(
    Effect.scoped(
      Effect.gen(function*() {
        const app = yield* createApp()
        yield* Effect.acquireRelease(
          Effect.sync(() => {
            const vueApp = createVueApp(AppRoot, { app })
            vueApp.provide(registryKey, app.registry)
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
