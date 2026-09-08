// @vitest-environment happy-dom
import { Mutation, QueryClient } from "@effect-stack/query"
import { createQueryContext, type MutationResult, useMutation } from "@effect-stack/query-react"
import { scheduleTask } from "@effect/atom-react"
import { Context, Deferred, Effect, Exit, Option, Scope } from "effect"
import { AtomRegistry } from "effect/unstable/reactivity"
import * as React from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it } from "vitest"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const QueryApp = createQueryContext<{}>()
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

describe.sequential("useMutation", () => {
  it("lets an accepted write complete after its observer unmounts", async () => {
    const client = makeClient()
    const started = Effect.runSync(Deferred.make<void>())
    const writeGate = Effect.runSync(Deferred.make<void>())
    const finalized = Effect.runSync(Deferred.make<void>())
    const handle = Effect.runSync(client.mutation(Mutation.make<void, string>({
      name: "observer-departure",
      execute: () =>
        Effect.acquireUseRelease(
          Deferred.succeed(started, undefined),
          () => Deferred.await(writeGate).pipe(Effect.as("written")),
          () => Deferred.succeed(finalized, undefined)
        )
    })))
    const registry = makeRegistry({ defaultIdleTTL: 60_000 })
    let controls: MutationResult<void, string, never> | undefined
    function Probe() {
      controls = useMutation(handle)
      return null
    }
    const root = createRoot(document.createElement("div"))
    await React.act(async () => {
      root.render(
        <QueryApp.Provider value={{}} registry={registry}>
          <Probe />
        </QueryApp.Provider>
      )
      await flush()
    })
    const beforeExecute = registry.getNodes().size
    let result: Promise<string> | undefined
    await React.act(async () => {
      result = controls?.execute(undefined)
      await Effect.runPromise(Deferred.await(started))
    })
    await React.act(async () => root.unmount())
    await Promise.resolve()
    expect(Effect.runSync(Deferred.isDone(finalized))).toBe(false)
    expect(registry.getNodes().size).toBeLessThan(beforeExecute)
    await React.act(async () => {
      Effect.runSync(Deferred.succeed(writeGate, undefined))
      await expect(result).resolves.toBe("written")
      await Effect.runPromise(Deferred.await(finalized))
      await flush()
    })
    registry.dispose()
  })

  it("returns typed failures through executeExit without rejecting", async () => {
    const client = makeClient()
    const handle = Effect.runSync(client.mutation(Mutation.make<number, number, "rejected">({
      name: "exit",
      execute: () => Effect.fail("rejected")
    })))
    const registry = makeRegistry()
    let controls: MutationResult<number, number, "rejected"> | undefined
    function Probe() {
      controls = useMutation(handle)
      return null
    }
    const root = createRoot(document.createElement("div"))
    cleanups.push(async () => {
      await React.act(async () => root.unmount())
      registry.dispose()
    })
    await React.act(async () => {
      root.render(
        <QueryApp.Provider value={{}} registry={registry}>
          <Probe />
        </QueryApp.Provider>
      )
      await flush()
    })
    let exit: Exit.Exit<number, "rejected"> | undefined
    await React.act(async () => {
      exit = await controls?.executeExit(1, { signal: new AbortController().signal })
      await flush()
    })
    expect(exit !== undefined && Exit.isFailure(exit)).toBe(true)
  })

  it("returns each concurrent invocation outcome independent of completion order", async () => {
    const client = makeClient()
    const first = Effect.runSync(Deferred.make<number>())
    const second = Effect.runSync(Deferred.make<number>())
    const handle = Effect.runSync(client.mutation(Mutation.make<"first" | "second", number>({
      name: "ordered",
      execute: (input) => Deferred.await(input === "first" ? first : second)
    })))
    const registry = makeRegistry()
    let controls: MutationResult<"first" | "second", number, never> | undefined
    function Probe() {
      controls = useMutation(handle)
      return <span>{controls.state.pendingCount}</span>
    }
    const root = createRoot(document.createElement("div"))
    cleanups.push(async () => {
      await React.act(async () => root.unmount())
      registry.dispose()
    })
    await React.act(async () => {
      root.render(
        <QueryApp.Provider value={{}} registry={registry}>
          <Probe />
        </QueryApp.Provider>
      )
      await flush()
    })
    let firstPromise: Promise<number> | undefined
    let secondPromise: Promise<number> | undefined
    await React.act(async () => {
      firstPromise = controls?.execute("first")
      secondPromise = controls?.execute("second")
      await flush()
    })
    expect(firstPromise).toBeDefined()
    expect(secondPromise).toBeDefined()
    await React.act(async () => {
      Effect.runSync(Deferred.succeed(second, 2))
      expect(await secondPromise).toBe(2)
      await flush()
    })
    await React.act(async () => {
      Effect.runSync(Deferred.succeed(first, 1))
      expect(await firstPromise).toBe(1)
      await flush()
    })
    const latest = controls?.state.latest ?? Option.none()
    expect(Option.isSome(latest) ? latest.value.input : undefined).toBe("second")
    expect(Option.isSome(latest) ? latest.value.result._tag : undefined).toBe("Success")
  })

  it("separates waiter abort from explicit invocation interruption", async () => {
    const client = makeClient()
    const waiterStarted = Effect.runSync(Deferred.make<void>())
    const waiterFinalized = Effect.runSync(Deferred.make<void>())
    const explicitStarted = Effect.runSync(Deferred.make<void>())
    const explicitFinalized = Effect.runSync(Deferred.make<void>())
    const handle = Effect.runSync(client.mutation(Mutation.make<"waiter" | "explicit", never>({
      name: "interruptions",
      execute: (input) =>
        Effect.acquireUseRelease(
          Deferred.succeed(input === "waiter" ? waiterStarted : explicitStarted, undefined),
          () => Effect.never,
          () => Deferred.succeed(input === "waiter" ? waiterFinalized : explicitFinalized, undefined)
        )
    })))
    const registry = makeRegistry()
    let controls: MutationResult<"waiter" | "explicit", never, never> | undefined
    function Probe() {
      controls = useMutation(handle)
      return null
    }
    const root = createRoot(document.createElement("div"))
    cleanups.push(async () => {
      await React.act(async () => root.unmount())
      registry.dispose()
    })
    await React.act(async () => {
      root.render(
        <QueryApp.Provider value={{}} registry={registry}>
          <Probe />
        </QueryApp.Provider>
      )
      await flush()
    })
    const abort = new AbortController()
    let waiting: Promise<never> | undefined
    await React.act(async () => {
      waiting = controls?.execute("waiter", { signal: abort.signal })
      await Effect.runPromise(Deferred.await(waiterStarted))
      await flush()
    })
    await React.act(async () => {
      abort.abort()
      await expect(waiting).rejects.toBeDefined()
      await flush()
    })
    expect(Effect.runSync(Deferred.isDone(waiterFinalized))).toBe(false)

    const invocation = await React.act(async () => {
      const accepted = await Effect.runPromise(controls?.startEffect("explicit") ?? Effect.die("missing controls"))
      await Effect.runPromise(Deferred.await(explicitStarted))
      await flush()
      return accepted
    })
    await React.act(async () => {
      await Effect.runPromise(invocation.interrupt)
      await Effect.runPromise(Deferred.await(explicitFinalized))
      await flush()
    })
    expect(Effect.runSync(Deferred.isDone(waiterFinalized))).toBe(false)
  })

  it("switches observation and callback identity with a new handle", async () => {
    const client = makeClient()
    const first = Effect.runSync(
      client.mutation(Mutation.make<number, number>({ name: "first", execute: Effect.succeed }))
    )
    const second = Effect.runSync(
      client.mutation(Mutation.make<number, number>({ name: "second", execute: Effect.succeed }))
    )
    const registry = makeRegistry()
    const seen: Array<MutationResult<number, number, never>> = []
    function Probe({ handle }: { readonly handle: Mutation.Handle<number, number, never> }) {
      seen.push(useMutation(handle))
      return null
    }
    const root = createRoot(document.createElement("div"))
    cleanups.push(async () => {
      await React.act(async () => root.unmount())
      registry.dispose()
    })
    await React.act(async () =>
      root.render(
        <QueryApp.Provider value={{}} registry={registry}>
          <Probe handle={first} />
        </QueryApp.Provider>
      )
    )
    const firstControls = seen.at(-1)
    await React.act(async () =>
      root.render(
        <QueryApp.Provider value={{}} registry={registry}>
          <Probe handle={second} />
        </QueryApp.Provider>
      )
    )
    const secondControls = seen.at(-1)
    expect(secondControls?.executeEffect).not.toBe(firstControls?.executeEffect)
    await React.act(async () => {
      expect(await secondControls?.execute(2)).toBe(2)
      await flush()
    })
  })
})
