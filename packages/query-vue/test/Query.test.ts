// @vitest-environment happy-dom
import { Query } from "@effect-stack/query"
import { createQueryContext, useQuery } from "@effect-stack/query-vue"
import { Deferred, Effect, Option } from "effect"
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry"
import { afterEach, describe, expect, it } from "vitest"
import { defineComponent, h, nextTick, render, shallowRef, type VNode } from "vue"
import {
  awaitStarted,
  formatResult,
  type Gate,
  gated,
  makeGate,
  makeScopedClient,
  releaseGate,
  rendererDrain
} from "./harness.ts"

const cleanups: Array<() => void> = []
afterEach(() => {
  // LIFO teardown without allocation: unmounts release before registries close.
  let cleanup = cleanups.pop()
  while (cleanup !== undefined) {
    cleanup()
    cleanup = cleanups.pop()
  }
})

interface App {
  readonly label: string
}

const { Provider, useQueryContext } = createQueryContext<App>()

interface Fixture {
  readonly gates: Map<string, Gate>
  readonly attempts: () => number
  readonly resource: (key: string) => Query.Resource<string, never>
}

const makeFixture = (name: string): Fixture => {
  const gates = new Map<string, Gate>()
  let attempts = 0
  const definition = Query.make<string, string, never>({
    name,
    staleTime: "1 hours",
    load: (key) =>
      Effect.gen(function*() {
        attempts += 1
        const attempt = attempts
        return yield* gated(gates.get(key)!, () => `${key}#${attempt}`)
      })
  })
  const { client, dispose } = makeScopedClient()
  cleanups.push(() => void dispose())
  const family = client.query(definition)
  return {
    gates,
    attempts: () => attempts,
    resource: (key) => family(key)
  }
}

const makeGateFor = (fixture: Fixture, key: string): Gate => {
  const gate = makeGate()
  fixture.gates.set(key, gate)
  return gate
}

const mount = (registry: AtomRegistry.AtomRegistry, views: () => VNode | VNode[]) => {
  const container = document.createElement("div")
  document.body.append(container)
  render(h(Provider, { value: { label: "app" }, registry }, { default: () => [views()].flat() }), container)
  cleanups.push(() => container.remove())
  return container
}

describe.sequential("Vue query bindings", () => {
  it("publishes waiting and success for one mounted resource through the App context", async () => {
    const fixture = makeFixture("list")
    const gate = makeGateFor(fixture, "all")
    const resource = fixture.resource("all")
    const registry = AtomRegistry.make()
    cleanups.push(() => registry.dispose())
    const View = defineComponent({
      setup() {
        const app = useQueryContext()
        const result = useQuery(() => resource)
        return () => h("p", `${app.value.label}:${formatResult(result.value)}`)
      }
    })
    const container = mount(registry, () => h(View))
    // Mounting acquires the read interest synchronously: the fresh entry is
    // already loading on first paint, so observers see waiting, then success.
    expect(container.textContent).toBe("app:waiting")
    await releaseGate(gate)
    expect(container.textContent).toBe("app:success:all#1")
    render(null, container)
  })

  it("shares one load across mounted readers of the same resource", async () => {
    const fixture = makeFixture("shared")
    const gate = makeGateFor(fixture, "same")
    const resource = fixture.resource("same")
    const registry = AtomRegistry.make()
    cleanups.push(() => registry.dispose())
    const Reader = defineComponent({
      name: "Reader",
      setup() {
        const result = useQuery(() => resource)
        return () => h("span", formatResult(result.value))
      }
    })
    const container = mount(registry, () => [h(Reader), h(Reader)])
    await releaseGate(gate)
    const readers = container.querySelectorAll("span")
    expect(readers[0]!.textContent).toBe("success:same#1")
    expect(readers[1]!.textContent).toBe("success:same#1")
    expect(fixture.attempts()).toBe(1)
    render(null, container)
  })

  it("publishes Initial without a lease for None and loads after switching to Some", async () => {
    const fixture = makeFixture("option")
    const gate = makeGateFor(fixture, "present")
    const selected = shallowRef<Option.Option<Query.Resource<string, never>>>(Option.none())
    const registry = AtomRegistry.make()
    cleanups.push(() => registry.dispose())
    const View = defineComponent({
      setup() {
        const result = useQuery(selected)
        return () => h("p", formatResult(result.value))
      }
    })
    const container = mount(registry, () => h(View))
    await rendererDrain()
    await nextTick()
    expect(container.textContent).toBe("initial")
    expect(fixture.attempts()).toBe(0)
    selected.value = Option.some(fixture.resource("present"))
    await rendererDrain()
    await nextTick()
    expect(container.textContent).toBe("waiting")
    await releaseGate(gate)
    expect(container.textContent).toBe("success:present#1")
    selected.value = Option.none()
    await rendererDrain()
    await nextTick()
    expect(container.textContent).toBe("initial")
    render(null, container)
  })

  it("drops unrelated previous data when switching to a loading resource", async () => {
    const fixture = makeFixture("dependent")
    const gateA = makeGateFor(fixture, "a")
    const gateB = makeGateFor(fixture, "b")
    const selected = shallowRef(fixture.resource("a"))
    const registry = AtomRegistry.make()
    cleanups.push(() => registry.dispose())
    const View = defineComponent({
      setup() {
        const result = useQuery(selected)
        return () => h("p", formatResult(result.value))
      }
    })
    const container = mount(registry, () => h(View))
    await releaseGate(gateA)
    expect(container.textContent).toBe("success:a#1")
    selected.value = fixture.resource("b")
    await rendererDrain()
    await nextTick()
    // The new resource republishes from its own state, never A's unrelated data.
    expect(container.textContent).toBe("waiting")
    await releaseGate(gateB)
    expect(container.textContent).toBe("success:b#2")
    render(null, container)
  })

  it("releases the abandoned interest on switching, so late old loads cannot publish", async () => {
    const fixture = makeFixture("abandon")
    const gateFirst = makeGateFor(fixture, "first")
    const gateSecond = makeGateFor(fixture, "second")
    const selected = shallowRef(fixture.resource("first"))
    const registry = AtomRegistry.make()
    cleanups.push(() => registry.dispose())
    const View = defineComponent({
      setup() {
        const result = useQuery(selected)
        return () => h("p", formatResult(result.value))
      }
    })
    const container = mount(registry, () => h(View))
    await awaitStarted(gateFirst)
    expect(fixture.attempts()).toBe(1)
    selected.value = fixture.resource("second")
    await rendererDrain()
    await nextTick()
    // Losing the last interest interrupts the abandoned attempt.
    await Effect.runPromise(Deferred.await(gateFirst.cancelled))
    expect(container.textContent).toBe("waiting")
    // Releasing the superseded gate cannot resurrect it into this observer.
    Effect.runSync(Deferred.succeed(gateFirst.release, undefined))
    await rendererDrain()
    await nextTick()
    expect(container.textContent).toBe("waiting")
    await releaseGate(gateSecond)
    expect(container.textContent).toBe("success:second#2")
    render(null, container)
  })

  it("follows shallow refs and plain values, reusing cached data on swap", async () => {
    const fixture = makeFixture("forms")
    const gateFirst = makeGateFor(fixture, "first")
    const gateSecond = makeGateFor(fixture, "second")
    const registry = AtomRegistry.make()
    cleanups.push(() => registry.dispose())
    const selected = shallowRef<Query.Resource<string, never>>(fixture.resource("first"))
    const View = defineComponent({
      setup() {
        const byRef = useQuery(selected)
        const byValue = useQuery(fixture.resource("second"))
        return () => h("p", `${formatResult(byRef.value)}|${formatResult(byValue.value)}`)
      }
    })
    const container = mount(registry, () => h(View))
    await Promise.all([releaseGate(gateFirst), releaseGate(gateSecond)])
    await nextTick()
    expect(container.textContent).toBe("success:first#1|success:second#2")
    selected.value = fixture.resource("second")
    await rendererDrain()
    await nextTick()
    expect(container.textContent).toBe("success:second#2|success:second#2")
    render(null, container)
  })
})
