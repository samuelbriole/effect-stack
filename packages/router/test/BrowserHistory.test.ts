// @vitest-environment happy-dom
import * as BrowserHistory from "@effect-web/router/BrowserHistory"
import * as History from "@effect-web/router/History"
import * as Route from "@effect-web/router/Route"
import * as Router from "@effect-web/router/Router"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Ref from "effect/Ref"
import * as Stream from "effect/Stream"
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry"
import { vi } from "vitest"

const trackEventListeners = () => {
  const originalAdd = window.addEventListener
  const originalRemove = window.removeEventListener
  const addEventListener = vi.fn(originalAdd)
  const removeEventListener = vi.fn(originalRemove)
  window.addEventListener = addEventListener
  window.removeEventListener = removeEventListener
  return {
    addEventListener,
    removeEventListener,
    restore: () => {
      window.addEventListener = originalAdd
      window.removeEventListener = originalRemove
    }
  }
}

describe.sequential("BrowserHistory", () => {
  it.effect("reads, pushes, and replaces browser locations", () =>
    Effect.gen(function*() {
      window.history.replaceState(null, "", "/initial")
      const history = yield* BrowserHistory.make()

      const initial = yield* history.current
      expect(initial.pathname).toBe("/initial")

      const pushed = yield* history.push(History.destinationFromHref("/projects/42?tab=activity#details", { ok: true }))
      expect(History.toHref(pushed)).toBe("/projects/42?tab=activity#details")
      expect(pushed.state).toEqual({ ok: true })

      const replaced = yield* history.replace(History.destinationFromHref("/projects/43"))
      expect(replaced.pathname).toBe("/projects/43")
      expect(replaced.index).toBe(pushed.index)
    }))

  it.effect("streams popstate without duplicating direct pushes and removes its listener", () =>
    Effect.gen(function*() {
      window.history.replaceState(null, "", "/initial")
      const tracked = trackEventListeners()
      yield* Effect.addFinalizer(() => Effect.sync(tracked.restore))
      const history = yield* BrowserHistory.make()
      const changes = yield* Ref.make<ReadonlyArray<History.Location>>([])
      const listener = yield* history.changes.pipe(
        Stream.runForEach((location) => Ref.update(changes, (current) => [...current, location])),
        Effect.forkChild
      )
      yield* Effect.yieldNow

      yield* history.push(History.destinationFromHref("/direct"))
      yield* Effect.yieldNow
      expect(yield* Ref.get(changes)).toEqual([])

      const externalState = { owner: "outside-router" }
      window.history.replaceState(externalState, "", "/external?from=pop#state")
      window.dispatchEvent(new PopStateEvent("popstate", { state: externalState }))
      yield* Effect.yieldNow
      expect((yield* Ref.get(changes)).map(History.toHref)).toEqual(["/external?from=pop#state"])
      expect((yield* Ref.get(changes))[0].state).toEqual(externalState)

      yield* Fiber.interrupt(listener)
      expect(tracked.addEventListener.mock.calls.some(([type]) => type === "popstate")).toBe(true)
      expect(tracked.removeEventListener.mock.calls.some(([type]) => type === "popstate")).toBe(true)
    }))

  it.effect("removes the router popstate listener when its Atom registry is disposed", () =>
    Effect.gen(function*() {
      window.history.replaceState(null, "", "/")
      const tracked = trackEventListeners()
      yield* Effect.addFinalizer(() => Effect.sync(tracked.restore))
      const home = Route.make({ id: "home", path: "/", params: {}, search: {} })
      const router = Router.make({ routes: [home], layer: BrowserHistory.layer })
      const registry = AtomRegistry.make()
      yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()))
      registry.mount(router.state)
      yield* AtomRegistry.getResult(registry, router.state, { suspendOnWaiting: true })
      yield* Effect.yieldNow

      expect(tracked.addEventListener.mock.calls.some(([type]) => type === "popstate")).toBe(true)
      registry.dispose()
      expect(tracked.removeEventListener.mock.calls.some(([type]) => type === "popstate")).toBe(true)
    }))
})
