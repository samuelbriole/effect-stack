// @vitest-environment happy-dom
import { Mutation, Query } from "@effect-stack/query"
import { createQueryContext, type MutationResult, useMutation, useQuery } from "@effect-stack/query-solid"
import { RegistryContext, useAtomValue as useAmbientAtomValue } from "@effect/atom-solid"
import { Effect } from "effect"
import * as Deferred from "effect/Deferred"
import { AtomRegistry } from "effect/unstable/reactivity"
import * as Atom from "effect/unstable/reactivity/Atom"
import { createSignal, type JSX } from "solid-js"
import { render } from "solid-js/web"
import { afterEach, describe, expect, it } from "vitest"
import {
  drain,
  format,
  type Gate,
  makeClient,
  makeControlledClient,
  makeGate,
  mount,
  registerCleanup,
  runCleanups
} from "./shared/solid.ts"

afterEach(async () => {
  await runCleanups()
})

const probe = Atom.make(1)

interface TestApp {
  readonly label: string
  readonly users: Query.Resource<string, never>
  readonly rename: Mutation.Handle<string, string, never>
}

interface Harness {
  readonly app: (label: string) => TestApp
  readonly gate: Gate
}

const Context = createQueryContext<TestApp>()

const makeHarness = (executions: Array<string>): Harness => {
  const client = makeClient()
  const gate = makeGate()
  const users = client.query(Query.make({ name: "users", load: gate.load }))("all")
  return {
    app: (label) => ({
      label,
      rename: Effect.runSync(
        client.mutation(
          Mutation.make({
            name: `${label}/rename`,
            execute: (input: string) =>
              Effect.sync(() => {
                executions.push(`${label}:${input}`)
                return `${label}:${input}`
              })
          })
        )
      ),
      users
    }),
    gate
  }
}

function Reader(): JSX.Element {
  const context = Context.useQueryContext()
  const users = useQuery(() => context().users)
  return <span>{format(users())}</span>
}

describe.sequential("Query Provider", () => {
  it("fails with an actionable error outside its Provider", () => {
    const Alien = createQueryContext<{ readonly alien: true }>()
    function ReadThrough(): JSX.Element {
      Context.useQueryContext()
      return <span />
    }
    // The alien Provider installs a registry but not this context's application value.
    expect(() =>
      render(
        () => (
          <Alien.Provider value={{ alien: true }}>
            <ReadThrough />
          </Alien.Provider>
        ),
        document.createElement("div")
      )
    ).toThrow(/createQueryContext/)
  })

  it("does not dispose a borrowed registry when the subtree unmounts", async () => {
    const registry = AtomRegistry.make()
    const executions: Array<string> = []
    const { app, gate } = makeHarness(executions)
    registerCleanup(() => registry.dispose())

    const { container, dispose } = mount(() => (
      <Context.Provider value={app("borrowed")} registry={registry}>
        <Reader />
      </Context.Provider>
    ))
    await drain()
    expect(gate.starts.all).toBe(1)
    gate.release("all")
    await drain()
    expect(container.textContent).toBe("success:all#1")

    dispose()
    await drain()
    // The borrowed registry and the application-owned client both survive unmount.
    expect(registry.get(probe)).toBe(1)
    expect(gate.interrupts.all).toBeUndefined()

    // A later subtree rebinds to the same live registry and refetches stale data.
    const second = mount(() => (
      <Context.Provider value={app("borrowed")} registry={registry}>
        <Reader />
      </Context.Provider>
    ))
    await drain()
    expect(gate.starts.all).toBe(2)
    expect(second.container.textContent).toBe("success:all#2")
  })

  it("disposes the owned registry and interrupts in-flight loads on unmount", async () => {
    const executions: Array<string> = []
    const { app, gate } = makeHarness(executions)

    const { dispose } = mount(() => (
      <Context.Provider value={app("owned")}>
        <Reader />
      </Context.Provider>
    ))
    await drain()
    expect(gate.starts.all).toBe(1)

    dispose()
    await drain()
    // Owned registry disposal released the read lease, interrupting the request.
    expect(gate.interrupts.all).toBe(1)

    // The client is application-owned: it stays usable without the adapter.
    const refetch = Effect.runPromise(app("owned").users.get)
    await drain()
    expect(gate.starts.all).toBe(2)
    gate.release("all")
    expect(await refetch).toBe("all#2")
  })

  it("remounts the keyed subtree when the borrowed registry is replaced", async () => {
    const first = AtomRegistry.make()
    const second = AtomRegistry.make()
    registerCleanup(() => {
      first.dispose()
      second.dispose()
    })
    const executions: Array<string> = []
    const { app, gate } = makeHarness(executions)
    const [registry, setRegistry] = createSignal<AtomRegistry.AtomRegistry>(first)
    let setups = 0

    function CountingReader(): JSX.Element {
      setups += 1
      return <Reader />
    }

    const { container } = mount(() => (
      <Context.Provider value={app("replace")} registry={registry()}>
        <CountingReader />
      </Context.Provider>
    ))
    await drain()
    expect(setups).toBe(1)
    expect(gate.starts.all).toBe(1)

    setRegistry(second)
    await drain()
    // Replacement remounted the subtree and rebound readers to the new registry.
    expect(setups).toBe(2)
    // The new lease joins the still in-flight request before the retired
    // registry's idle node releases its own, so no duplicate load starts.
    expect(gate.starts.all).toBe(1)
    // The retired borrowed registry remains undisposed.
    expect(first.get(probe)).toBe(1)

    gate.release("all")
    await drain()
    // Publication flows through the new registry's subscription.
    expect(container.textContent).toBe("success:all#1")
  })

  it("cancels a joined load at the last interest and awaits its finalizer at client close", async () => {
    const first = AtomRegistry.make()
    const second = AtomRegistry.make()
    registerCleanup(() => {
      first.dispose()
      second.dispose()
    })
    const { client, close } = makeControlledClient()
    const starts: Record<string, number> = {}
    const cancelled: Record<string, number> = {}
    const finalizerStarted: Array<string> = []
    const hold = Deferred.makeUnsafe<void>()
    const finished = Deferred.makeUnsafe<void>()
    const users = client.query(
      Query.make({
        name: "swap-cancel",
        load: (key: string) =>
          Effect.as(
            Effect.acquireUseRelease(
              Effect.sync(() => {
                starts[key] = (starts[key] ?? 0) + 1
              }),
              () =>
                Deferred.await(hold).pipe(
                  Effect.onInterrupt(() =>
                    Effect.sync(() => {
                      cancelled[key] = (cancelled[key] ?? 0) + 1
                    })
                  )
                ),
              () =>
                Effect.sync(() => {
                  finalizerStarted.push(key)
                }).pipe(Effect.andThen(Deferred.await(finished)), Effect.asVoid)
            ),
            "late"
          )
      })
    )("all")
    const rename = Effect.runSync(
      client.mutation(
        Mutation.make({
          name: "swap-cancel/rename",
          execute: (input: string) => Effect.succeed(input)
        })
      )
    )
    const app: TestApp = { label: "swap", rename, users }
    const [registry, setRegistry] = createSignal<AtomRegistry.AtomRegistry>(first)

    const { dispose } = mount(() => (
      <Context.Provider value={app} registry={registry()}>
        <Reader />
      </Context.Provider>
    ))
    await drain()
    expect(starts.all).toBe(1)
    expect(cancelled.all).toBeUndefined()

    // Swapping registries mid-load must not spuriously cancel the shared work:
    // the replacement lease joins the in-flight request.
    setRegistry(second)
    await drain()
    expect(starts.all).toBe(1)
    expect(cancelled.all).toBeUndefined()

    // Unmounting the replacement while both borrowed registries stay alive
    // releases the last interest: cancellation begins the async finalizer.
    dispose()
    await drain()
    expect(cancelled.all).toBe(1)
    expect(finalizerStarted).toEqual(["all"])

    // Closing the application-owned client demonstrably awaits that finalizer.
    let closed = false
    const closing = close().then(() => {
      closed = true
    })
    await drain()
    expect(closed).toBe(false)
    Effect.runSync(Deferred.succeed(finished, undefined))
    await closing
    expect(closed).toBe(true)
  })

  it("binds through the ambient native registry under registry=\"inherit\" and leaves it usable", async () => {
    const ambient = AtomRegistry.make()
    registerCleanup(() => ambient.dispose())
    const executions: Array<string> = []
    const { app, gate } = makeHarness(executions)
    let evaluations = 0
    const sentinel = Atom.make(() => {
      evaluations += 1
      return "ambient"
    })

    function AmbientProbe(): JSX.Element {
      const observed = useAmbientAtomValue(() => sentinel)
      const context = Context.useQueryContext()
      const users = useQuery(() => context().users)
      return <span>{`observed:${observed()}:${format(users())}`}</span>
    }

    const ambientTree = () => (
      <RegistryContext.Provider value={ambient}>
        <Context.Provider value={app("inherit")} registry="inherit">
          <AmbientProbe />
        </Context.Provider>
      </RegistryContext.Provider>
    )

    const { container, dispose } = mount(ambientTree)
    await drain()
    // The subtree bound its subscriptions through this very registry instance:
    // reading the sentinel back through it reuses the mounted node.
    expect(evaluations).toBe(1)
    expect(ambient.get(sentinel)).toBe("ambient")
    expect(evaluations).toBe(1)
    expect(gate.starts.all).toBe(1)
    gate.release("all")
    await drain()
    expect(container.textContent).toBe("observed:ambient:success:all#1")

    // Removing the query subtree leaves the ambient registry fully usable.
    dispose()
    await drain()
    const second = mount(ambientTree)
    await drain()
    expect(gate.starts.all).toBe(2)
    expect(second.container.textContent).toBe("observed:ambient:success:all#2")
    expect(ambient.get(sentinel)).toBe("ambient")
  })

  it("publishes a replaced application value to mounted consumers without remounting", async () => {
    const registry = AtomRegistry.make()
    registerCleanup(() => registry.dispose())
    const executions: Array<string> = []
    const { app, gate } = makeHarness(executions)
    const [current, setCurrent] = createSignal<TestApp>(app("first"))
    let setups = 0
    let mutation!: MutationResult<string, string, never>

    function Consumer(): JSX.Element {
      setups += 1
      const context = Context.useQueryContext()
      const users = useQuery(() => context().users)
      mutation = useMutation(() => context().rename)
      return <span>{`${context().label}:${format(users())}`}</span>
    }

    const { container } = mount(() => (
      <Context.Provider value={current()} registry={registry}>
        <Consumer />
      </Context.Provider>
    ))
    await drain()
    expect(setups).toBe(1)
    expect(container.textContent).toBe("first:initial+waiting")
    gate.release("all")
    await drain()
    expect(container.textContent).toBe("first:success:all#1")

    // Both apps share one client and one users resource identity, but carry a
    // distinct rename handle. The mounted component must observe the new App
    // through its accessor without remounting or refetching the shared resource.
    setCurrent(app("second"))
    await drain()
    expect(setups).toBe(1)
    expect(gate.starts.all).toBe(1)
    expect(container.textContent).toBe("second:success:all#1")

    // Actions read the current application value when they are invoked.
    expect(await mutation.execute("x")).toBe("second:x")
    expect(executions).toEqual(["second:x"])
  })
})
