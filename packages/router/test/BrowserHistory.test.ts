// @vitest-environment happy-dom
import * as BrowserHistory from "@effect-web/router/BrowserHistory"
import * as History from "@effect-web/router/History"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Ref from "effect/Ref"
import * as Stream from "effect/Stream"
import { vi } from "vitest"

describe("BrowserHistory", () => {
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
      const addEventListener = vi.spyOn(window, "addEventListener")
      const removeEventListener = vi.spyOn(window, "removeEventListener")
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          addEventListener.mockRestore()
          removeEventListener.mockRestore()
        })
      )
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

      window.history.replaceState(window.history.state, "", "/external?from=pop#state")
      window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }))
      yield* Effect.yieldNow
      expect((yield* Ref.get(changes)).map(History.toHref)).toEqual(["/external?from=pop#state"])

      yield* Fiber.interrupt(listener)
      expect(addEventListener.mock.calls.some(([type]) => type === "popstate")).toBe(true)
      expect(removeEventListener.mock.calls.some(([type]) => type === "popstate")).toBe(true)
    }))
})
