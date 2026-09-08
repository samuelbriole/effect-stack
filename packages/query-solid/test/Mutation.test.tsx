// @vitest-environment happy-dom
import { Mutation } from "@effect-stack/query"
import { createQueryContext, type MutationResult, useMutation } from "@effect-stack/query-solid"
import { Effect, Exit, Option, Schema } from "effect"
import * as Cause from "effect/Cause"
import { createMemo, createSignal, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { afterEach, describe, expect, it } from "vitest"
import { drain, format, makeClient, makeGate, mount, runCleanups } from "./shared/solid.ts"

afterEach(async () => {
  await runCleanups()
})

class RenameError extends Schema.TaggedError<RenameError>()("RenameError", {
  reason: Schema.String
}) {}

interface RenameApp {
  readonly rename: Mutation.Handle<string, string, RenameError>
}

const Rename = createQueryContext<RenameApp>()

function Probe(props: {
  readonly expose: (mutation: MutationResult<string, string, RenameError>) => void
}): JSX.Element {
  const context = Rename.useQueryContext()
  const mutation = useMutation(() => context().rename)
  props.expose(mutation)
  const latest = createMemo(() =>
    Option.match(mutation.state().latest, {
      onNone: () => "-",
      onSome: (entry) => `#${String(entry.id)}:${entry.input}:${format(entry.result)}`
    })
  )
  return (
    <span>
      pending:{String(mutation.state().pendingCount)} latest:{latest()}
    </span>
  )
}

const makeApp = (gate: ReturnType<typeof makeGate>): RenameApp => {
  const client = makeClient()
  const rename = Effect.runSync(
    client.mutation(
      Mutation.make<string, string, RenameError>({
        name: "rename",
        execute: (input) =>
          Effect.gen(function*() {
            if (input === "boom") return yield* new RenameError({ reason: `rejected ${input}` })
            return yield* gate.load(input)
          })
      })
    )
  )
  return { rename }
}

describe.sequential("useMutation", () => {
  it("keeps out-of-order invocations separate and tracks the latest started", async () => {
    const gate = makeGate()
    const app = makeApp(gate)
    let mutation!: MutationResult<string, string, RenameError>

    const { container } = mount(() => (
      <Rename.Provider value={app}>
        <Probe expose={(current) => (mutation = current)} />
      </Rename.Provider>
    ))
    await drain()
    expect(container.textContent).toBe("pending:0 latest:-")
    expect(gate.starts).toEqual({})

    const first = mutation.execute("ada")
    const second = mutation.execute("grace")
    await drain()
    expect(gate.starts).toEqual({ ada: 1, grace: 1 })
    expect(container.textContent).toBe("pending:2 latest:#2:grace:initial+waiting")

    // The second invocation completes first; state.latest still follows start order.
    gate.release("grace")
    expect(await second).toBe("grace#1")
    await drain()
    expect(container.textContent).toBe("pending:1 latest:#2:grace:success:grace#1")

    gate.release("ada")
    expect(await first).toBe("ada#1")
    await drain()
    expect(container.textContent).toBe("pending:0 latest:#2:grace:success:grace#1")
  })

  it("aborting a waiter leaves the accepted invocation running", async () => {
    const gate = makeGate()
    const app = makeApp(gate)
    let mutation!: MutationResult<string, string, RenameError>

    const { container } = mount(() => (
      <Rename.Provider value={app}>
        <Probe expose={(current) => (mutation = current)} />
      </Rename.Provider>
    ))
    await drain()

    const controller = new AbortController()
    const waiter = mutation.execute("slow", { signal: controller.signal })
    await drain()
    expect(gate.starts.slow).toBe(1)

    controller.abort()
    await expect(waiter).rejects.toBeDefined()
    await drain()
    // The client-owned invocation survived its waiter's abort.
    expect(container.textContent).toBe("pending:1 latest:#1:slow:initial+waiting")
    gate.release("slow")
    await drain()
    expect(container.textContent).toBe("pending:0 latest:#1:slow:success:slow#1")
  })

  it("interrupts through the invocation handle after finalizers complete", async () => {
    const gate = makeGate()
    const app = makeApp(gate)
    let mutation!: MutationResult<string, string, RenameError>

    mount(() => (
      <Rename.Provider value={app}>
        <Probe expose={(current) => (mutation = current)} />
      </Rename.Provider>
    ))
    await drain()

    const invocation = await Effect.runPromise(mutation.startEffect("x"))
    await drain()
    expect(gate.starts.x).toBe(1)
    const awaited = Effect.runPromiseExit(invocation.await)
    await drain()
    expect(gate.interrupts.x).toBeUndefined()

    await Effect.runPromise(invocation.interrupt)
    // The interrupt effect completed only after the invocation's finalizer ran.
    expect(gate.interrupts.x).toBe(1)
    const callExit = await awaited
    expect(Exit.isFailure(callExit) && Cause.hasInterruptsOnly(callExit.cause)).toBe(true)
  })

  it("returns typed failures as Exits without throwing", async () => {
    const gate = makeGate()
    const app = makeApp(gate)
    let mutation!: MutationResult<string, string, RenameError>

    mount(() => (
      <Rename.Provider value={app}>
        <Probe expose={(current) => (mutation = current)} />
      </Rename.Provider>
    ))
    await drain()

    const exit = await mutation.executeExit("boom")
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(Cause.findErrorOption(exit.cause)).toEqual(Option.some(new RenameError({ reason: "rejected boom" })))
    }
    expect(gate.starts).toEqual({})
  })

  it("selects the current handle when each action is invoked", async () => {
    interface SelectApp {
      readonly handle: Mutation.Handle<string, string, never>
    }
    const Select = createQueryContext<SelectApp>()
    const client = makeClient()
    const makeHandle = (label: string) =>
      Effect.runSync(
        client.mutation(
          Mutation.make({
            name: `select-${label}`,
            execute: (input: string) => Effect.sync(() => `${label}:${input}`)
          })
        )
      )
    const [handle, setHandle] = createSignal(makeHandle("first"))
    let mutation!: MutationResult<string, string, never>

    function Runner(): JSX.Element {
      const context = Select.useQueryContext()
      mutation = useMutation(() => context().handle)
      return <span>{String(mutation.state().pendingCount)}</span>
    }

    mount(() => (
      <Select.Provider value={{ handle: handle() }}>
        <Runner />
      </Select.Provider>
    ))
    await drain()

    const early = mutation.execute("a")
    setHandle(makeHandle("second"))
    await drain()
    const late = mutation.execute("b")
    // Each action captured the handle selected when it was invoked.
    expect(await early).toBe("first:a")
    expect(await late).toBe("second:b")
  })

  it("routes actions and state through a handle held in a native Solid store", async () => {
    interface StoreApp {
      rename: Mutation.Handle<string, string, never>
    }
    const StoreCtx = createQueryContext<StoreApp>()
    const gate = makeGate()
    const client = makeClient()
    const makeHandle = (label: string) =>
      Effect.runSync(
        client.mutation(
          Mutation.make<string, string>({
            name: `store-${label}`,
            execute: (input) =>
              Effect.gen(function*() {
                yield* gate.load(input)
                return `${label}:${input}`
              })
          })
        )
      )
    const [store, setStore] = createStore<StoreApp>({ rename: makeHandle("first") })
    let mutation!: MutationResult<string, string, never>

    function StoreProbe(): JSX.Element {
      const context = StoreCtx.useQueryContext()
      mutation = useMutation(() => context().rename)
      return <span>{String(mutation.state().pendingCount)}</span>
    }

    const { container } = mount(() => (
      <StoreCtx.Provider value={store}>
        <StoreProbe />
      </StoreCtx.Provider>
    ))
    await drain()
    expect(container.textContent).toBe("0")
    expect(gate.starts).toEqual({})

    const early = mutation.execute("a")
    await drain()
    expect(gate.starts.a).toBe(1)
    expect(container.textContent).toBe("1")

    // Replacing the stored handle reroutes later actions and state, while the
    // already accepted invocation stays with its captured controller. Bulk
    // root assignment replaces the plain-object handle instead of merging it.
    setStore({ rename: makeHandle("second") })
    await drain()
    const late = mutation.execute("b")
    await drain()
    gate.release("a")
    gate.release("b")
    expect(await early).toBe("first:a")
    expect(await late).toBe("second:b")
    await drain()
    expect(container.textContent).toBe("0")
  })

  it("survives observer unmount and finishes the accepted invocation's own result", async () => {
    const gate = makeGate()
    const app = makeApp(gate)
    let mutation!: MutationResult<string, string, RenameError>

    const { dispose } = mount(() => (
      <Rename.Provider value={app}>
        <Probe expose={(current) => (mutation = current)} />
      </Rename.Provider>
    ))
    await drain()

    const accepted = mutation.execute("slow")
    await drain()
    expect(gate.starts.slow).toBe(1)

    dispose()
    await drain()
    // Observer removal never touches the client-owned invocation.
    const running = await Effect.runPromise(app.rename.snapshot)
    expect(running.pendingCount).toBe(1)

    gate.release("slow")
    expect(await accepted).toBe("slow#1")
    const done = await Effect.runPromise(app.rename.snapshot)
    expect(done.pendingCount).toBe(0)
    expect(done.latest._tag).toBe("Some")
    if (Option.isSome(done.latest)) {
      expect(done.latest.value.input).toBe("slow")
      expect(done.latest.value.result._tag).toBe("Success")
    }
  })

  it("captures the controller when an action is built, not when its effect runs", async () => {
    interface SelectApp {
      readonly handle: Mutation.Handle<string, string, never>
    }
    const Select = createQueryContext<SelectApp>()
    const gate = makeGate()
    const client = makeClient()
    const first = Effect.runSync(
      client.mutation(
        Mutation.make<string, string>({
          name: "capture-first",
          execute: (input) => gate.load(input).pipe(Effect.map((value) => `first:${value}`))
        })
      )
    )
    const second = Effect.runSync(
      client.mutation(
        Mutation.make<string, string>({
          name: "capture-second",
          execute: (input) => gate.load(input).pipe(Effect.map((value) => `second:${value}`))
        })
      )
    )
    const [handle, setHandle] = createSignal(first)
    let mutation!: MutationResult<string, string, never>

    function Runner(): JSX.Element {
      const context = Select.useQueryContext()
      mutation = useMutation(() => context().handle)
      return <span>{String(mutation.state().pendingCount)}</span>
    }

    const { container } = mount(() => (
      <Select.Provider value={{ handle: handle() }}>
        <Runner />
      </Select.Provider>
    ))
    await drain()

    // Build the actions against the first controller, then switch selection
    // before running either Effect.
    const started = mutation.startEffect("y")
    const executed = mutation.executeEffect("z")
    setHandle(second)
    await drain()
    // Creating actions started nothing on either controller.
    expect((await Effect.runPromise(first.snapshot)).pendingCount).toBe(0)
    expect((await Effect.runPromise(second.snapshot)).pendingCount).toBe(0)
    expect(gate.starts).toEqual({})

    const invocation = await Effect.runPromise(started)
    const result = Effect.runPromise(executed)
    await drain()
    gate.release("y")
    gate.release("z")
    // Both ran on the captured original controller with separate outcomes.
    expect(await result).toBe("first:z#1")
    expect(await Effect.runPromise(invocation.await)).toBe("first:y#1")
    const owner = await Effect.runPromise(first.snapshot)
    expect(owner.pendingCount).toBe(0)
    expect(owner.latest._tag).toBe("Some")
    if (Option.isSome(owner.latest)) {
      expect(owner.latest.value.input).toBe("z")
    }
    // The switched-to controller stayed untouched, and observed state follows it.
    const idle = await Effect.runPromise(second.snapshot)
    expect(idle.latest._tag).toBe("None")
    expect(idle.pendingCount).toBe(0)
    expect(container.textContent).toBe("0")
  })
})
