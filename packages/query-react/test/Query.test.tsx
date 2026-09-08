// @vitest-environment happy-dom
import { Query, QueryAtom, QueryClient } from "@effect-stack/query"
import { createQueryContext, useQuery } from "@effect-stack/query-react"
import { RegistryContext, scheduleTask } from "@effect/atom-react"
import { Context, Deferred, Effect, Exit, Fiber, Option, Scope } from "effect"
import { AtomRegistry } from "effect/unstable/reactivity"
import * as React from "react"
import { flushSync } from "react-dom"
import { createRoot, type Root } from "react-dom/client"
import { renderToString } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

interface TestApp {
  readonly label: string
}

const QueryApp = createQueryContext<TestApp>()
const cleanups: Array<() => Promise<void>> = []

const flushTurn = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))
const flush = async (): Promise<void> => {
  await flushTurn()
  await flushTurn()
  await flushTurn()
  await flushTurn()
}

const makeRegistry = (options?: { readonly defaultIdleTTL?: number }): AtomRegistry.AtomRegistry =>
  AtomRegistry.make({ ...options, scheduleTask })

const mount = async (node: React.ReactNode): Promise<{ readonly container: HTMLElement; readonly root: Root }> => {
  const container = document.createElement("div")
  const root = createRoot(container)
  await React.act(async () => {
    root.render(node)
    await flush()
  })
  cleanups.push(async () => {
    await React.act(async () => {
      root.unmount()
      await flush()
    })
  })
  return { container, root }
}

const makeClient = () => {
  const scope = Effect.runSync(Scope.make())
  const client = Effect.runSync(
    QueryClient.makeWith(Context.empty()).pipe(Effect.provideService(Scope.Scope, scope))
  )
  cleanups.push(() => Effect.runPromise(Scope.close(scope, Exit.void)))
  return client
}

const cleanupAll = async (): Promise<void> => {
  const cleanup = cleanups.pop()
  if (cleanup === undefined) return
  await cleanup()
  return cleanupAll()
}

afterEach(cleanupAll)

describe.sequential("useQuery commit gate", () => {
  it("does not start work for an abandoned initial Suspense render", async () => {
    const client = makeClient()
    const family = client.query(Query.make<void, string>({
      name: "suspense-gate",
      load: () =>
        Effect.sync(() => {
          starts++
          return "ready"
        })
    }))
    const resource = family(undefined)
    let starts = 0
    let allow = false
    let resume: (() => void) | undefined
    const suspended = new Promise<void>((resolve) => {
      resume = resolve
    })
    function Probe() {
      const result = useQuery(resource)
      if (!allow) throw suspended
      return <span>{result._tag}</span>
    }
    const { container } = await mount(
      <QueryApp.Provider value={{ label: "app" }}>
        <React.Suspense fallback={<span>fallback</span>}>
          <Probe />
        </React.Suspense>
      </QueryApp.Provider>
    )
    expect(container.textContent).toBe("fallback")
    expect(starts).toBe(0)

    await React.act(async () => {
      allow = true
      resume?.()
      await suspended
      await flush()
    })
    expect(starts).toBe(1)
  })

  it("keeps the committed resource and never starts an abandoned transition resource", async () => {
    const client = makeClient()
    const aStarted = Effect.runSync(Deferred.make<void>())
    const aValue = Effect.runSync(Deferred.make<string>())
    const aFinalized = Effect.runSync(Deferred.make<void>())
    let bStarts = 0
    const family = client.query(Query.make<string, string>({
      name: "transition-gate",
      load: (key) =>
        key === "a"
          ? Effect.acquireUseRelease(
            Deferred.succeed(aStarted, undefined),
            () => Deferred.await(aValue),
            () => Deferred.succeed(aFinalized, undefined)
          )
          : Effect.sync(() => {
            bStarts++
            return "b"
          })
    }))
    const blocker = new Promise<void>(() => {})
    let select: ((key: "a" | "b") => void) | undefined
    function Probe() {
      const [key, setKey] = React.useState<"a" | "b">("a")
      select = setKey
      const result = useQuery(family(key))
      if (key === "b") throw blocker
      return <span>{result._tag === "Success" ? result.value : result._tag}</span>
    }
    const { container } = await mount(
      <QueryApp.Provider value={{ label: "app" }}>
        <React.Suspense fallback={<span>pending</span>}>
          <Probe />
        </React.Suspense>
      </QueryApp.Provider>
    )
    await Effect.runPromise(Deferred.await(aStarted))
    await React.act(async () => {
      React.startTransition(() => select?.("b"))
      await flush()
    })
    expect(bStarts).toBe(0)
    expect(Effect.runSync(Deferred.isDone(aFinalized))).toBe(false)
    await React.act(async () => {
      Effect.runSync(Deferred.succeed(aValue, "a-published"))
      await flush()
    })
    expect(container.textContent).toBe("a-published")
  })

  it("commits a resource swap as Initial without carrying A data and releases A interest", async () => {
    const client = makeClient()
    const refreshStarted = Effect.runSync(Deferred.make<void>())
    const refreshFinalized = Effect.runSync(Deferred.make<void>())
    let aLoads = 0
    const family = client.query(Query.make<string, string>({
      name: "committed-swap",
      load: (key) => {
        if (key === "b") return Effect.never
        aLoads++
        return aLoads === 1
          ? Effect.succeed("unrelated-a-data")
          : Effect.acquireUseRelease(
            Deferred.succeed(refreshStarted, undefined),
            () => Effect.never,
            () => Deferred.succeed(refreshFinalized, undefined)
          )
      },
      staleTime: "1 hour"
    }))
    const resourceA = family("a")
    let select: ((key: "a" | "b") => void) | undefined
    function Probe() {
      const [key, setKey] = React.useState<"a" | "b">("a")
      select = setKey
      const result = useQuery(family(key))
      return <span>{result._tag === "Success" ? result.value : result._tag}</span>
    }
    const { container } = await mount(
      <QueryApp.Provider value={{ label: "app" }}>
        <Probe />
      </QueryApp.Provider>
    )
    await React.act(flush)
    expect(container.textContent).toBe("unrelated-a-data")
    await React.act(async () => {
      await Effect.runPromise(resourceA.invalidate)
      await Effect.runPromise(Deferred.await(refreshStarted))
      await flush()
    })
    await React.act(async () => {
      flushSync(() => select?.("b"))
      expect(container.textContent).toBe("Initial")
      expect(container.textContent).not.toContain("unrelated-a-data")
    })
    await Effect.runPromise(Deferred.await(refreshFinalized))
  })

  it("releases its StrictMode lease and disposes its owned registry after the native grace period", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] })
    const client = makeClient()
    const started = Effect.runSync(Deferred.make<void>())
    const finalized = Effect.runSync(Deferred.make<void>())
    let starts = 0
    let finalizations = 0
    const resource = client.query(Query.make<void, never>({
      name: "strict",
      load: () =>
        Effect.acquireUseRelease(
          Effect.sync(() => {
            starts++
            Effect.runSync(Deferred.succeed(started, undefined))
          }),
          () => Effect.never,
          () => Effect.sync(() => finalizations++).pipe(Effect.andThen(Deferred.succeed(finalized, undefined)))
        )
    }))(undefined)
    let ownedRegistry: AtomRegistry.AtomRegistry | undefined
    function Probe() {
      ownedRegistry = React.useContext(RegistryContext)
      useQuery(resource)
      return null
    }
    const root = createRoot(document.createElement("div"))
    try {
      await React.act(async () => {
        root.render(
          <React.StrictMode>
            <QueryApp.Provider value={{ label: "app" }}>
              <Probe />
            </QueryApp.Provider>
          </React.StrictMode>
        )
      })
      await Effect.runPromise(Deferred.await(started))
      expect(starts).toBeGreaterThanOrEqual(1)
      if (ownedRegistry === undefined) throw new Error("owned registry was not captured")
      const dispose = vi.spyOn(ownedRegistry, "dispose")
      const beforeUnmount = finalizations
      await React.act(async () => {
        root.unmount()
        await flush()
      })
      await Promise.resolve()
      await Effect.runPromise(Deferred.await(finalized))
      expect(finalizations).toBeGreaterThan(beforeUnmount)
      expect(ownedRegistry.getNodes().has(QueryAtom.query(resource))).toBe(false)
      expect(dispose).not.toHaveBeenCalled()
      await React.act(async () => vi.advanceTimersByTime(499))
      expect(dispose).not.toHaveBeenCalled()
      await React.act(async () => vi.advanceTimersByTime(1))
      expect(dispose).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it("reclaims inert bridge nodes from an abandoned render", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] })
    const client = makeClient()
    let starts = 0
    const resource = client.query(Query.make<void, string>({
      name: "abandoned-node",
      load: () =>
        Effect.sync(() => {
          starts++
          return "unexpected"
        })
    }))(undefined)
    const registry = makeRegistry({ defaultIdleTTL: 60_000 })
    const before = registry.getNodes().size
    let duringRender = before
    const root = createRoot(document.createElement("div"))
    const suspended = new Promise<void>(() => {})
    function Probe(): React.ReactNode {
      useQuery(resource)
      duringRender = Math.max(duringRender, registry.getNodes().size)
      throw suspended
    }
    try {
      await React.act(async () => {
        root.render(
          <QueryApp.Provider value={{ label: "app" }} registry={registry}>
            <React.Suspense fallback={null}>
              <Probe />
            </React.Suspense>
          </QueryApp.Provider>
        )
      })
      expect(starts).toBe(0)
      expect(duringRender).toBeGreaterThan(before)
      expect(registry.getNodes().size).toBe(before)
      await React.act(async () => root.unmount())
      await React.act(async () => vi.advanceTimersByTime(1_000))
      expect(registry.getNodes().size).toBe(before)
    } finally {
      registry.dispose()
      vi.useRealTimers()
    }
  })

  it("treats None as inert and releases interest when switching to None", async () => {
    const client = makeClient()
    const started = Effect.runSync(Deferred.make<void>())
    const interrupted = Effect.runSync(Deferred.make<void>())
    const resource = client.query(Query.make<void, never>({
      name: "optional",
      load: () =>
        Effect.acquireUseRelease(
          Deferred.succeed(started, undefined),
          () => Effect.never,
          () => Deferred.succeed(interrupted, undefined)
        )
    }))(undefined)
    let select: ((selected: boolean) => void) | undefined
    function Probe() {
      const [selected, setSelected] = React.useState(false)
      select = setSelected
      const result = useQuery(selected ? Option.some(resource) : Option.none<typeof resource>())
      return <span>{result._tag}</span>
    }
    const { container } = await mount(
      <QueryApp.Provider value={{ label: "app" }}>
        <Probe />
      </QueryApp.Provider>
    )
    expect(container.textContent).toBe("Initial")
    expect(Effect.runSync(Deferred.isDone(started))).toBe(false)
    await React.act(async () => {
      select?.(true)
      await flush()
    })
    await Effect.runPromise(Deferred.await(started))
    await React.act(async () => {
      select?.(false)
      await flush()
    })
    await Effect.runPromise(Deferred.await(interrupted))
    expect(container.textContent).toBe("Initial")
  })

  it("deduplicates two committed consumers with an Effect reader", async () => {
    const client = makeClient()
    const gate = Effect.runSync(Deferred.make<void>())
    let starts = 0
    const resource = client.query(Query.make<void, string>({
      name: "shared",
      load: () =>
        Effect.gen(function*() {
          starts++
          yield* Deferred.await(gate)
          return "done"
        })
    }))(undefined)
    let effectRead: Fiber.Fiber<string, never> | undefined
    function Probe() {
      const result = useQuery(resource)
      return <span>{result._tag}</span>
    }
    const { container } = await mount(
      <QueryApp.Provider value={{ label: "app" }}>
        <Probe />
        <Probe />
      </QueryApp.Provider>
    )
    await React.act(async () => {
      effectRead = Effect.runFork(resource.get)
      await flush()
    })
    expect(starts).toBe(1)
    await React.act(async () => {
      Effect.runSync(Deferred.succeed(gate, undefined))
      if (effectRead === undefined) throw new Error("Effect reader did not start")
      await Effect.runPromise(Fiber.join(effectRead))
      await flush()
    })
    expect(container.textContent).toBe("SuccessSuccess")
  })
})

describe.sequential("Query provider", () => {
  it("releases the old query lease and reconnects it through a replacement registry", async () => {
    const client = makeClient()
    const started = Effect.runSync(Deferred.make<void>())
    const finalized = Effect.runSync(Deferred.make<void>())
    const resource = client.query(Query.make<void, never>({
      name: "registry-replacement",
      load: () =>
        Effect.acquireUseRelease(
          Deferred.succeed(started, undefined),
          () => Effect.never,
          () => Deferred.succeed(finalized, undefined)
        )
    }))(undefined)
    const queryAtom = QueryAtom.query(resource)
    const first = makeRegistry()
    const second = makeRegistry()
    const firstDispose = vi.spyOn(first, "dispose")
    const secondDispose = vi.spyOn(second, "dispose")
    const events: Array<string> = []
    function Child() {
      useQuery(resource)
      React.useEffect(() => {
        events.push("mount")
        return () => {
          events.push("unmount")
        }
      }, [])
      return null
    }
    const { root } = await mount(
      <QueryApp.Provider value={{ label: "app" }} registry={first}>
        <Child />
      </QueryApp.Provider>
    )
    await Effect.runPromise(Deferred.await(started))
    expect(first.getNodes().has(queryAtom)).toBe(true)
    await React.act(async () => {
      root.render(
        <QueryApp.Provider value={{ label: "app" }} registry={second}>
          <Child />
        </QueryApp.Provider>
      )
      await flush()
    })
    expect(events).toEqual(["mount", "unmount", "mount"])
    expect(first.getNodes().has(queryAtom)).toBe(false)
    expect(second.getNodes().has(queryAtom)).toBe(true)
    expect(Effect.runSync(Deferred.isDone(finalized))).toBe(false)
    expect(firstDispose).not.toHaveBeenCalled()
    await React.act(async () => {
      root.unmount()
      await flush()
    })
    await Effect.runPromise(Deferred.await(finalized))
    expect(second.getNodes().has(queryAtom)).toBe(false)
    expect(firstDispose).not.toHaveBeenCalled()
    expect(secondDispose).not.toHaveBeenCalled()
    first.dispose()
    second.dispose()
  })

  it("inherits the surrounding native registry and reports a matching-provider error", async () => {
    const registry = makeRegistry()
    function ContextValue() {
      return <span>{QueryApp.useQueryContext().label}</span>
    }
    const { container } = await mount(
      <RegistryContext.Provider value={registry}>
        <QueryApp.Provider value={{ label: "inherited" }} registry="inherit">
          <ContextValue />
        </QueryApp.Provider>
      </RegistryContext.Provider>
    )
    expect(container.textContent).toBe("inherited")
    registry.dispose()

    function Missing() {
      QueryApp.useQueryContext()
      return null
    }
    expect(() => renderToString(<Missing />)).toThrow(/matching Query Provider/)
  })
})
