// @vitest-environment happy-dom
import { registryKey } from "@effect/atom-vue"
import { History, MemoryHistory } from "@effect-stack/router"
import * as AtomRouter from "@effect-stack/router/AtomRouter"
import { Link, Navigate, Provider, make, route, useRetry } from "@effect-stack/router-vue"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Logger from "effect/Logger"
import { Atom, AtomRegistry } from "effect/reactivity"
import { defineComponent, h, nextTick, provide, render } from "vue"
import { afterEach, describe, expect, it, vi } from "vitest"

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

const failure = new History.HistoryError({ operation: "push", message: "write failed", cause: "storage" })
const defect = new Error("history defect")
const writeCause = Cause.combine(Cause.fail(failure), Cause.die(defect))
const failingHistory = Layer.effect(
  History.History,
  Effect.gen(function* () {
    const history = yield* MemoryHistory.make()
    return { ...history, push: () => Effect.failCause(writeCause) }
  })
)

const mount = (command: "link" | "navigate" | "gate" | "retry") => {
  const logs: Array<Logger.Options<unknown>> = []
  let gateRuns = 0
  let failCurrent = false
  const retryHistory = Layer.effect(
    History.History,
    Effect.gen(function* () {
      const history = yield* MemoryHistory.make()
      return { ...history, current: Effect.suspend(() => (failCurrent ? Effect.die(defect) : history.current)) }
    })
  )
  const Retry = defineComponent({
    setup() {
      const retry = useRetry()
      return () => h("button", { onClick: retry }, "Retry")
    }
  })
  const Target = route("target", "/target", {
    prepare: () =>
      Effect.suspend(() => {
        gateRuns++
        return command === "gate" ? Effect.fail("gate failed") : Effect.void
      }),
    render: () => h("p", "Target"),
    error: () => h("div", [h("p", "Gate error"), h(Retry)])
  })
  const Home = route("home", "/", {
    render: () =>
      h("main", [
        h("p", "Home"),
        command === "navigate"
          ? h(Navigate, { to: Target.to() })
          : command === "retry"
            ? h(Retry)
            : h(Link, { to: Target.to() }, { default: () => "Target" })
      ])
  })
  const app = make("VueCommandDiagnostics", [Home, Target])
  const runtime = Atom.runtime(
    app.layer.pipe(
      Layer.provide(command === "gate" ? MemoryHistory.layer() : command === "retry" ? retryHistory : failingHistory),
      Layer.provide(
        Logger.layer([
          Logger.make((options) => {
            logs.push(options)
          })
        ])
      )
    )
  )
  const registry = AtomRegistry.make()
  const router = AtomRouter.make(runtime, app)
  const container = document.createElement("div")
  document.body.append(container)
  render(
    h(
      defineComponent({
        setup() {
          provide(registryKey, registry)
          return () => h(Provider<typeof app>, { app, runtime })
        }
      })
    ),
    container
  )
  cleanups.push(() => {
    render(null, container)
    registry.dispose()
    container.remove()
  })
  return {
    container,
    logs,
    router,
    registry,
    gateRuns: () => gateRuns,
    failCurrent: () => {
      failCurrent = true
    }
  }
}

const click = async (container: HTMLElement, selector: string) => {
  container.querySelector(selector)?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }))
  await nextTick()
}

describe("Vue detached command diagnostics", { concurrent: false }, () => {
  it("logs a useRetry observed-location defect once without replacing the last branch", async () => {
    const fixture = mount("retry")
    await vi.waitFor(() => expect(fixture.container.textContent).toContain("Home"))
    const service = await Effect.runPromise(AtomRegistry.getResult(fixture.registry, fixture.router.service))
    const before = await Effect.runPromise(service.state)
    fixture.failCurrent()
    await click(fixture.container, "button")
    await vi.waitFor(() => expect(fixture.logs).toHaveLength(1))
    expect(fixture.logs[0]?.cause.reasons).toMatchObject([{ _tag: "Die", defect }])
    expect(fixture.logs[0]?.cause.reasons).toHaveLength(1)
    const after = await Effect.runPromise(service.state)
    expect(after.status).toEqual(before.status)
    expect(after.presentation).toEqual(before.presentation)
    expect(after.resolved).toEqual(before.resolved)
  })
  it("logs a Link write failure once with its whole Cause without changing the committed branch/status", async () => {
    const { container, logs, router, registry } = mount("link")
    await vi.waitFor(() => expect(container.textContent).toContain("Home"))
    const service = await Effect.runPromise(AtomRegistry.getResult(registry, router.service))
    const before = await Effect.runPromise(service.state)
    await click(container, "a")
    await vi.waitFor(() => expect(logs).toHaveLength(1))
    expect(logs[0]?.cause.reasons).toMatchObject([
      { _tag: "Fail", error: failure },
      { _tag: "Die", defect }
    ])
    expect(logs[0]?.cause.reasons).toHaveLength(2)
    const after = await Effect.runPromise(service.state)
    expect(after.status).toEqual(before.status)
    expect(after.presentation).toEqual(before.presentation)
    expect(after.resolved).toEqual(before.resolved)
    expect(container.textContent).toContain("Home")
  })

  it("logs a mounted Navigate write failure once through the application Logger", async () => {
    const { container, logs } = mount("navigate")
    await vi.waitFor(() => expect(logs).toHaveLength(1))
    expect(logs[0]?.cause.reasons).toMatchObject([
      { _tag: "Fail", error: failure },
      { _tag: "Die", defect }
    ])
    expect(logs[0]?.cause.reasons).toHaveLength(2)
    expect(container.textContent).toContain("Home")
  })

  it("does not log published Gate failures from Link or useRetry again", async () => {
    const fixture = mount("gate")
    await vi.waitFor(() => expect(fixture.container.textContent).toContain("Home"))
    await click(fixture.container, "a")
    await vi.waitFor(() => expect(fixture.container.textContent).toContain("Gate error"))
    expect(fixture.logs).toHaveLength(0)
    const service = await Effect.runPromise(AtomRegistry.getResult(fixture.registry, fixture.router.service))
    const first = (await Effect.runPromise(service.state)).status
    await click(fixture.container, "button")
    await vi.waitFor(() => expect(fixture.gateRuns()).toBe(2))
    await vi.waitFor(async () => {
      const status = (await Effect.runPromise(service.state)).status
      expect(status._tag).toBe("Failed")
      expect(status).not.toEqual(first)
    })
    expect(fixture.container.textContent).toContain("Gate error")
    expect(fixture.logs).toHaveLength(0)
  })
})
