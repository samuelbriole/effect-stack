// @vitest-environment happy-dom
import { Query, QueryAtom } from "@effect-stack/query"
import { createQueryContext, useQuery } from "@effect-stack/query-vue"
import { defaultRegistry, injectRegistry, registryKey } from "@effect/atom-vue"
import { Deferred, Effect } from "effect"
import type * as Scope from "effect/Scope"
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry"
import { afterAll, afterEach, describe, expect, it, vi } from "vitest"
import { defineComponent, h, nextTick, onErrorCaptured, provide, type Ref, render, shallowRef, type VNode } from "vue"
import { awaitStarted, formatResult, type Gate, gated, makeGate, makeScopedClient, rendererDrain } from "./harness.ts"

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
const { Provider: OtherProvider, useQueryContext: useOtherContext } = createQueryContext<App>()

const scoped = makeScopedClient()
const definition = Query.make<string, string, never>({
  name: "provider",
  staleTime: "1 hours",
  load: (key) => Effect.succeed(key)
})
const resource = scoped.client.query(definition)("value")
const resourceAtom = QueryAtom.query(resource)

const Child = defineComponent({
  props: { captureRegistry: { type: Boolean, default: false } },
  setup(props) {
    if (props.captureRegistry) captured.registries.push(injectRegistry())
    const app = useQueryContext()
    const result = useQuery(() => resource)
    return () => h("p", `${app.value.label}:${formatResult(result.value)}`)
  }
})

const makeChild = (readApp: () => Readonly<Ref<App>>) =>
  defineComponent({
    setup() {
      const app = readApp()
      const result = useQuery(() => resource)
      return () => h("p", `${app.value.label}:${formatResult(result.value)}`)
    }
  })

const captured = { registries: [] as Array<AtomRegistry.AtomRegistry> }

afterAll(async () => {
  await scoped.dispose()
})

const mountProvider = (root: () => VNode) => {
  const container = document.createElement("div")
  document.body.append(container)
  render(root(), container)
  cleanups.push(() => {
    render(null, container)
    container.remove()
  })
  return container
}

const succeed = (gate: Gate, which: "release" | "started"): void => {
  Effect.runSync(Deferred.succeed(which === "release" ? gate.release : gate.started, undefined))
}

const join = <A>(deferred: Deferred.Deferred<A>): Promise<A> => Effect.runPromise(Deferred.await(deferred))

const appValue: App = { label: "app" }

/** A gated query whose request scope signals async finalization after any end. */
interface FinalGate {
  readonly started: Deferred.Deferred<void>
  readonly release: Deferred.Deferred<void>
  readonly cancelled: Deferred.Deferred<void>
  readonly finalized: Deferred.Deferred<void>
}

interface Activity {
  readonly gateFor: (key: string) => FinalGate
  readonly resource: (key: string) => Query.Resource<string, never>
  readonly attempts: () => number
}

const makeActivity = (name: string): Activity => {
  const gates = new Map<string, Array<FinalGate>>()
  const consumed = new Map<string, number>()
  let attempts = 0
  // Effect.addFinalizer needs a Scope: the core request scope is supplied per attempt.
  const activityDefinition = Query.make<string, string, never, Scope.Scope>({
    name,
    staleTime: "1 hours",
    load: (key) =>
      Effect.gen(function*() {
        attempts += 1
        const index = consumed.get(key) ?? 0
        consumed.set(key, index + 1)
        const gate = gates.get(key)![index]!
        yield* Effect.addFinalizer(() => Deferred.succeed(gate.finalized, undefined).pipe(Effect.asVoid))
        yield* Deferred.succeed(gate.started, undefined)
        yield* Deferred.await(gate.release).pipe(
          Effect.onInterrupt(() => Deferred.succeed(gate.cancelled, undefined))
        )
        return `${key}#${attempts}`
      })
  })
  const activityClient = makeScopedClient()
  cleanups.push(() => void activityClient.dispose())
  const family = activityClient.client.query(activityDefinition)
  return {
    gateFor: (key) => {
      const list = gates.get(key) ?? []
      const gate: FinalGate = {
        started: Effect.runSync(Deferred.make<void>()),
        release: Effect.runSync(Deferred.make<void>()),
        cancelled: Effect.runSync(Deferred.make<void>()),
        finalized: Effect.runSync(Deferred.make<void>())
      }
      list.push(gate)
      gates.set(key, list)
      return gate
    },
    resource: (key) => family(key),
    attempts: () => attempts
  }
}

describe.sequential("Vue query provider", () => {
  it("borrows a supplied registry and never disposes it", async () => {
    captured.registries.length = 0
    const registry = AtomRegistry.make()
    cleanups.push(() => registry.dispose())
    const container = mountProvider(() =>
      h(
        Provider,
        { value: { label: "app" }, registry },
        { default: () => [h(Child, { captureRegistry: true })] }
      )
    )
    await rendererDrain()
    await nextTick()
    expect(container.textContent).toBe("app:success:value")
    expect(captured.registries).toEqual([registry])
    render(null, container)
    await rendererDrain()
    // Borrowed: still usable after the provider subtree unmounts.
    expect(formatResult(registry.get(resourceAtom))).toBe("success:value")
  })

  it("owns and disposes a registry when none is supplied", async () => {
    captured.registries.length = 0
    const container = mountProvider(() =>
      h(Provider, { value: { label: "app" } }, { default: () => [h(Child, { captureRegistry: true })] })
    )
    await rendererDrain()
    await nextTick()
    expect(container.textContent).toBe("app:success:value")
    const [owned] = captured.registries
    expect(owned).toBeDefined()
    render(null, container)
    await rendererDrain()
    expect(() => owned!.get(resourceAtom)).toThrow(/disposed/)
  })

  it("inherits the ambient native registry for the inherit slot", async () => {
    captured.registries.length = 0
    const ambient = AtomRegistry.make()
    cleanups.push(() => ambient.dispose())
    const Wrapper = defineComponent({
      setup(_props, { slots }) {
        provide(registryKey, ambient)
        return () => h(Provider, { value: { label: "app" }, registry: "inherit" as const }, slots)
      }
    })
    const container = mountProvider(() => h(Wrapper, null, { default: () => [h(Child, { captureRegistry: true })] }))
    await rendererDrain()
    await nextTick()
    expect(container.textContent).toBe("app:success:value")
    expect(captured.registries).toEqual([ambient])
    render(null, container)
    await rendererDrain()
    expect(() => ambient.get(resourceAtom)).not.toThrow()
  })

  it("falls back to the native default registry when inherit finds no ambient one", async () => {
    captured.registries.length = 0
    const container = mountProvider(() =>
      h(
        Provider,
        { value: { label: "app" }, registry: "inherit" as const },
        { default: () => [h(Child, { captureRegistry: true })] }
      )
    )
    await rendererDrain()
    expect(captured.registries).toEqual([defaultRegistry])
    render(null, container)
  })

  it("remounts the keyed subtree when the registry is replaced", async () => {
    captured.registries.length = 0
    const first = AtomRegistry.make()
    const second = AtomRegistry.make()
    cleanups.push(() => {
      first.dispose()
      second.dispose()
    })
    const selected = shallowRef<AtomRegistry.AtomRegistry>(first)
    const Root = defineComponent({
      setup(): () => VNode {
        return () =>
          h(Provider, { value: { label: "app" }, registry: selected.value }, {
            default: () => [h(Child, { captureRegistry: true })]
          })
      }
    })
    const container = mountProvider(() => h(Root))
    await rendererDrain()
    await nextTick()
    expect(captured.registries).toEqual([first])
    expect(container.textContent).toBe("app:success:value")
    selected.value = second
    await rendererDrain()
    await nextTick()
    // The subtree re-ran setup and now observes the second registry.
    expect(captured.registries).toEqual([first, second])
    expect(container.textContent).toBe("app:success:value")
    expect(formatResult(second.get(resourceAtom))).toBe("success:value")
  })

  it("publishes a replaced App value reactively without remounting consumers", async () => {
    captured.registries.length = 0
    let setups = 0
    const selected = shallowRef<App>({ label: "first" })
    const View = defineComponent({
      setup() {
        setups++
        const app = useQueryContext()
        const result = useQuery(() => resource)
        captured.registries.push(injectRegistry())
        return () => h("p", `${app.value.label}:${formatResult(result.value)}`)
      }
    })
    const Root = defineComponent({
      setup(): () => VNode {
        return () => h(Provider, { value: selected.value }, { default: () => [h(View)] })
      }
    })
    const container = mountProvider(() => h(Root))
    await rendererDrain()
    await nextTick()
    expect(container.textContent).toBe("first:success:value")
    expect(setups).toBe(1)
    const [registry] = captured.registries
    selected.value = { label: "second" }
    await rendererDrain()
    await nextTick()
    // The injected readonly ref republishes through Vue's own reactivity:
    // consumers update in place, keeping their mounted state and leases.
    expect(container.textContent).toBe("second:success:value")
    expect(setups).toBe(1)
    expect(captured.registries).toEqual([registry])
    expect(() => registry!.get(resourceAtom)).not.toThrow()
    // Local component state survives the swap because nothing remounted.
  })

  it("keeps separate contexts isolated", async () => {
    const one = AtomRegistry.make()
    const two = AtomRegistry.make()
    cleanups.push(() => {
      one.dispose()
      two.dispose()
    })
    const FirstChild = makeChild(useQueryContext)
    const SecondChild = makeChild(useOtherContext)
    const container = mountProvider(() =>
      h("div", [
        h(Provider, { value: { label: "one" }, registry: one }, { default: () => [h(FirstChild)] }),
        h(OtherProvider, { value: { label: "two" }, registry: two }, { default: () => [h(SecondChild)] })
      ])
    )
    await rendererDrain()
    await nextTick()
    expect(container.textContent).toBe("one:success:valuetwo:success:value")
  })

  it("throws an actionable error when the context is missing", async () => {
    let capturedError: unknown
    const Catcher = defineComponent({
      setup(_props, { slots }) {
        onErrorCaptured((error) => {
          capturedError = error
          return false
        })
        return () => slots.default?.()
      }
    })
    // The render option keeps the failed setup's mount quiet: without it Vue adds an
    // incidental "missing template or render function" warning because setup threw
    // before returning one. The captured error stays the only signal under test.
    const Orphan = defineComponent({
      setup() {
        useQueryContext()
        return () => null
      },
      render() {
        return null
      }
    })
    const container = document.createElement("div")
    render(h(Catcher, null, { default: () => [h(Orphan)] }), container)
    expect(capturedError).toBeInstanceOf(Error)
    expect(String(capturedError)).toContain("createQueryContext")
    render(null, container)
    container.remove()
  })

  it("hooks work under the plain ambient native registry, without this provider", async () => {
    const registry = AtomRegistry.make()
    const gate = makeGate()
    const fresh = scoped.client.query(
      Query.make<string, string, never>({
        name: "ambient",
        staleTime: "1 hours",
        load: () => gated(gate, () => "ambient")
      })
    )("ambient")
    const View = defineComponent({
      setup() {
        const result = useQuery(() => fresh)
        return () => h("p", formatResult(result.value))
      }
    })
    const Ambient = defineComponent({
      setup(_props, { slots }) {
        provide(registryKey, registry)
        return () => slots.default?.()
      }
    })
    const container = document.createElement("div")
    document.body.append(container)
    cleanups.push(() => {
      render(null, container)
      container.remove()
      registry.dispose()
    })
    render(h(Ambient, null, { default: () => [h(View)] }), container)
    expect(container.textContent).toBe("waiting")
    await awaitStarted(gate)
    succeed(gate, "release")
    await rendererDrain()
    await nextTick()
    expect(container.textContent).toBe("success:ambient")
  })

  it("replacing an owned registry with a borrowed one handovers active observation safely", async () => {
    const activity = makeActivity("handover")
    const borrowed = AtomRegistry.make()
    cleanups.push(() => borrowed.dispose())
    const first = activity.resource("first")
    const second = activity.resource("second")
    const firstAtom = QueryAtom.query(first)
    const secondAtom = QueryAtom.query(second)
    const selected = shallowRef<Query.Resource<string, never>>(first)
    const slot = shallowRef<AtomRegistry.AtomRegistry | undefined>(undefined)
    const registries: Array<AtomRegistry.AtomRegistry> = []
    let setups = 0
    const SwapChild = defineComponent({
      setup(): () => VNode {
        setups += 1
        registries.push(injectRegistry())
        const result = useQuery(() => selected.value)
        return () => h("p", formatResult(result.value))
      }
    })
    const Root = defineComponent({
      setup(): () => VNode {
        return () => {
          const registry = slot.value
          return h(
            Provider,
            { value: appValue, ...(registry === undefined ? {} : { registry }) },
            { default: () => [h(SwapChild)] }
          )
        }
      }
    })
    const gateFirst1 = activity.gateFor("first")
    const container = mountProvider(() => h(Root))
    await rendererDrain()
    await nextTick()
    expect(container.textContent).toBe("waiting")
    expect(setups).toBe(1)
    await join(gateFirst1.started)
    // Replace the owned registry while the load is active.
    const gateFirst2 = activity.gateFor("first")
    slot.value = borrowed
    await rendererDrain()
    await nextTick()
    const [owned] = registries
    expect(registries).toEqual([owned, borrowed])
    expect(setups).toBe(2)
    // The owned registry disposed with its subtree; the borrowed one is untouched.
    expect(() => owned!.get(firstAtom)).toThrow(/disposed/)
    // The abandoned attempt interrupts and its request-scope finalizer completes asynchronously.
    await join(gateFirst1.cancelled)
    await join(gateFirst1.finalized)
    // The replacement subtree observes through the borrowed registry with a fresh attempt.
    expect(container.textContent).toBe("waiting")
    await join(gateFirst2.started)
    const gateSecond = activity.gateFor("second")
    selected.value = second
    await rendererDrain()
    await nextTick()
    // Switching resources also releases the previous lease: the borrowed-attempt is abandoned.
    await join(gateFirst2.cancelled)
    await join(gateFirst2.finalized)
    await join(gateSecond.started)
    succeed(gateSecond, "release")
    await rendererDrain()
    await nextTick()
    expect(container.textContent).toBe(`success:second#${String(activity.attempts())}`)
    const secondLabel = container.textContent
    // Final unmount with an active load: last interest interrupts asynchronously.
    const gateThird = activity.gateFor("third")
    selected.value = activity.resource("third")
    await rendererDrain()
    await nextTick()
    await join(gateThird.started)
    render(null, container)
    await join(gateThird.cancelled)
    await join(gateThird.finalized)
    // The borrowed registry stays usable and cached data survives the observers.
    expect(formatResult(borrowed.get(secondAtom))).toBe(secondLabel)
    // The client scope is open: snapshots remain readable through the unmounted observer's resource.
    const snapshot = await Effect.runPromise(Effect.exit(second.snapshot))
    expect(snapshot._tag).toBe("Success")
  })

  it("carries a primitive App value through the reactive context without prop warnings", async () => {
    const warnings: Array<unknown> = []
    const warnSpy = vi.spyOn(console, "warn").mockImplementation((...args) => {
      warnings.push(args)
    })
    const errorSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
      warnings.push(args)
    })
    const { Provider: StringProvider, useQueryContext: useString } = createQueryContext<string>()
    const selected = shallowRef<string>("first")
    let missingError: unknown
    const View = defineComponent({
      setup(): () => VNode {
        const app = useString()
        return () => h("p", app.value)
      }
    })
    const Root = defineComponent({
      setup(): () => VNode {
        return () => h(StringProvider, { value: selected.value }, { default: () => [h(View)] })
      }
    })
    const container = document.createElement("div")
    document.body.append(container)
    cleanups.push(() => {
      render(null, container)
      container.remove()
      warnSpy.mockRestore()
      errorSpy.mockRestore()
    })
    render(h(Root), container)
    await rendererDrain()
    await nextTick()
    expect(container.textContent).toBe("first")
    // A reactive value replacement republishes through the readonly context ref.
    selected.value = "second"
    await rendererDrain()
    await nextTick()
    expect(container.textContent).toBe("second")
    // The sentinel still distinguishes "missing provider" from any falsy App value.
    const Catcher = defineComponent({
      setup(_props, { slots }) {
        onErrorCaptured((error) => {
          missingError = error
          return false
        })
        return () => slots.default?.()
      }
    })
    const Orphan = defineComponent({
      setup() {
        useString()
        return () => null
      },
      // Fallback render keeps the expected setup throw the only signal.
      render() {
        return null
      }
    })
    render(h(Catcher, null, { default: () => [h(Orphan)] }), document.createElement("div"))
    expect(missingError).toBeInstanceOf(Error)
    expect(String(missingError)).toContain("createQueryContext")
    // An empty string is a provided context value, not a missing provider.
    selected.value = ""
    await rendererDrain()
    await nextTick()
    expect(container.textContent).toBe("")
    expect(warnings).toEqual([])
  })

  it("unmounting an owned provider with an active load disposes and interrupts", async () => {
    const activity = makeActivity("owned-teardown")
    const solo = activity.resource("solo")
    const soloAtom = QueryAtom.query(solo)
    const gate = activity.gateFor("solo")
    const registries: Array<AtomRegistry.AtomRegistry> = []
    const View = defineComponent({
      setup(): () => VNode {
        registries.push(injectRegistry())
        const result = useQuery(() => solo)
        return () => h("p", formatResult(result.value))
      }
    })
    const container = mountProvider(() => h(Provider, { value: appValue }, { default: () => [h(View)] }))
    await rendererDrain()
    await nextTick()
    expect(container.textContent).toBe("waiting")
    await join(gate.started)
    render(null, container)
    const [owned] = registries
    // Losing the mounted observer releases the last interest: the load is interrupted and
    // its request-scope finalizers complete asynchronously.
    await join(gate.cancelled)
    await join(gate.finalized)
    expect(() => owned!.get(soloAtom)).toThrow(/disposed/)
    // The client outlives the provider: bound operations still respond.
    const snapshot = await Effect.runPromise(Effect.exit(solo.snapshot))
    expect(snapshot._tag).toBe("Success")
  })
})
