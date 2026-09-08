// @vitest-environment happy-dom
import { Mutation, QueryAtom } from "@effect-stack/query"
import { createQueryContext, useMutation } from "@effect-stack/query-vue"
import type * as MutationNS from "@effect-stack/query/Mutation"
import { Cause, Deferred, Effect, Exit, Option, Ref } from "effect"
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry"
import { afterEach, describe, expect, it } from "vitest"
import { defineComponent, h, nextTick, render, shallowRef, type VNode } from "vue"
import { awaitState, formatResult, type Gate, makeGate, makeScopedClient, rendererDrain } from "./harness.ts"

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

const { Provider } = createQueryContext<App>()

interface Controlled {
  readonly definition: Mutation.Mutation<string, string, never>
  readonly commits: Ref.Ref<number>
  readonly gateFor: (input: string) => Gate
}

/** A write gated per input: each invocation commits only when its own gate releases. */
const makeControlled = (name: string): Controlled => {
  const commits = Effect.runSync(Ref.make(0))
  const gates = new Map<string, Gate>()
  const definition = Mutation.make<string, string, never>({
    name,
    execute: (input) =>
      Effect.gen(function*() {
        const gate = gates.get(input)!
        yield* Deferred.succeed(gate.started, undefined)
        yield* Deferred.await(gate.release).pipe(
          Effect.onInterrupt(() => Deferred.succeed(gate.cancelled, undefined))
        )
        yield* Ref.update(commits, (count) => count + 1)
        return `${input}:committed`
      })
  })
  return {
    definition,
    commits,
    gateFor: (input) => {
      let gate = gates.get(input)
      if (gate === undefined) {
        gate = makeGate()
        gates.set(input, gate)
      }
      return gate
    }
  }
}

const formatState = (state: MutationNS.State<string, string, never>): string =>
  `${
    state.latest._tag === "Some" ? `${state.latest.value.input}:${formatResult(state.latest.value.result)}` : "none"
  }|pending:${String(state.pendingCount)}`

const succeed = <A>(deferred: Deferred.Deferred<A>, value: A): Promise<void> =>
  Effect.runPromise(Deferred.succeed(deferred, value).pipe(Effect.asVoid))

const awaitDeferred = <A>(deferred: Deferred.Deferred<A>): Promise<A> => Effect.runPromise(Deferred.await(deferred))

const drain = async (): Promise<void> => {
  await rendererDrain()
  await nextTick()
}

interface Mounted {
  readonly container: HTMLElement
  readonly registry: AtomRegistry.AtomRegistry
  readonly mutation: () => ReturnType<typeof useMutation<string, string, never>>
}

const mountMutation = (
  initial: MutationNS.Handle<string, string, never>,
  onSelect?: (select: (handle: MutationNS.Handle<string, string, never>) => void) => void
): Mounted => {
  const registry = AtomRegistry.make()
  const handle = shallowRef(initial)
  let current: ReturnType<typeof useMutation<string, string, never>> | undefined
  const View = defineComponent({
    setup(): () => VNode {
      current = useMutation(handle)
      return () => h("p", formatState(current!.state.value))
    }
  })
  onSelect?.((next) => {
    handle.value = next
  })
  const container = document.createElement("div")
  document.body.append(container)
  render(h(Provider, { value: { label: "app" }, registry }, { default: () => [h(View)] }), container)
  cleanups.push(() => {
    render(null, container)
    container.remove()
    registry.dispose()
  })
  return { container, registry, mutation: () => current! }
}

describe.sequential("Vue mutation bindings", () => {
  it("counts every pending invocation while latest tracks the most recent start", async () => {
    const controlled = makeControlled("rename")
    const { client, dispose } = makeScopedClient()
    cleanups.push(() => void dispose())
    const handle = Effect.runSync(client.mutation(controlled.definition))
    const { container, mutation } = mountMutation(handle)
    expect(container.textContent).toBe("none|pending:0")
    const gateOne = controlled.gateFor("one")
    const first = mutation().execute("one")
    await awaitDeferred(gateOne.started)
    const gateTwo = controlled.gateFor("two")
    const second = mutation().execute("two")
    await awaitDeferred(gateTwo.started)
    await drain()
    expect(container.textContent).toBe("two:waiting|pending:2")
    // "one" finishes first, but the later-started "two" owns `latest`.
    await succeed(gateOne.release, undefined)
    expect(await first).toBe("one:committed")
    await drain()
    expect(container.textContent).toBe("two:waiting|pending:1")
    await succeed(gateTwo.release, undefined)
    expect(await second).toBe("two:committed")
    await drain()
    expect(container.textContent).toBe("two:success:two:committed|pending:0")
    expect(Effect.runSync(Ref.get(controlled.commits))).toBe(2)
  })

  it("aborting the waiter leaves the accepted invocation running to commit", async () => {
    const controlled = makeControlled("waiter")
    const { client, dispose } = makeScopedClient()
    cleanups.push(() => void dispose())
    const handle = Effect.runSync(client.mutation(controlled.definition))
    const { registry, mutation } = mountMutation(handle)
    const controller = new AbortController()
    const gate = controlled.gateFor("call")
    const abandoned = mutation().execute("call", { signal: controller.signal })
    await awaitDeferred(gate.started)
    await drain()
    controller.abort()
    const rejection = await abandoned.then(
      () => "resolved",
      (error: unknown) => error
    )
    expect(rejection).toBeInstanceOf(Error)
    // The client-owned write continues: releasing it still commits.
    await succeed(gate.release, undefined)
    await drain()
    expect(Effect.runSync(Ref.get(controlled.commits))).toBe(1)
    const state = await awaitState(registry, QueryAtom.mutation(handle), (value) => value.pendingCount === 0)
    expect(formatState(state)).toBe("call:success:call:committed|pending:0")
  })

  it("unmounting does not interrupt accepted work and executeExit observes the outcome", async () => {
    const controlled = makeControlled("detached")
    const { client, dispose } = makeScopedClient()
    cleanups.push(() => void dispose())
    const handle = Effect.runSync(client.mutation(controlled.definition))
    const { container, registry, mutation } = mountMutation(handle)
    const gate = controlled.gateFor("call")
    const exit = mutation().executeExit("call")
    await awaitDeferred(gate.started)
    await drain()
    render(null, container)
    await drain()
    // Observation ended, but the invocation and its Promise waiter survive unmount.
    await succeed(gate.release, undefined)
    const outcome = await exit
    expect(Exit.isSuccess(outcome) && outcome.value).toBe("call:committed")
    expect(Effect.runSync(Ref.get(controlled.commits))).toBe(1)
    const state = await awaitState(registry, QueryAtom.mutation(handle), (value) => value.pendingCount === 0)
    expect(state.latest._tag).toBe("Some")
  })

  it("interrupts a started invocation through its handle without committing", async () => {
    const controlled = makeControlled("interrupt")
    const { client, dispose } = makeScopedClient()
    cleanups.push(() => void dispose())
    const handle = Effect.runSync(client.mutation(controlled.definition))
    const { container, mutation } = mountMutation(handle)
    const gate = controlled.gateFor("call")
    const invocation = await Effect.runPromise(mutation().startEffect("call"))
    await awaitDeferred(gate.started)
    await drain()
    expect(container.textContent).toBe("call:waiting|pending:1")
    await Effect.runPromise(invocation.interrupt)
    await awaitDeferred(gate.cancelled)
    expect(Effect.runSync(Ref.get(controlled.commits))).toBe(0)
    const waiter = await Effect.runPromise(invocation.await.pipe(Effect.exit))
    expect(Exit.isFailure(waiter) && Cause.hasInterruptsOnly(waiter.cause)).toBe(true)
    await drain()
    expect(container.textContent).toMatch(/^call:failure:.*\|pending:0$/)
  })

  it("selects the current handle at action time and follows state across swaps", async () => {
    const first = makeControlled("first")
    const second = makeControlled("second")
    const firstClient = makeScopedClient()
    cleanups.push(() => void firstClient.dispose())
    const firstHandle = Effect.runSync(firstClient.client.mutation(first.definition))
    const secondClient = makeScopedClient()
    cleanups.push(() => void secondClient.dispose())
    const secondHandle = Effect.runSync(secondClient.client.mutation(second.definition))
    let select!: (handle: MutationNS.Handle<string, string, never>) => void
    const { container, mutation } = mountMutation(firstHandle, (hook) => {
      select = hook
    })
    const gateOne = first.gateFor("one")
    const pending = mutation().execute("one")
    await awaitDeferred(gateOne.started)
    await drain()
    expect(container.textContent).toBe("one:waiting|pending:1")
    select(secondHandle)
    await drain()
    // State now observes the second controller, before any of its actions run.
    expect(container.textContent).toBe("none|pending:0")
    // The first waiter still completes with its own invocation's outcome.
    await succeed(gateOne.release, undefined)
    expect(await pending).toBe("one:committed")
    const gateTwo = second.gateFor("two")
    await succeed(gateTwo.release, undefined)
    expect(await mutation().execute("two")).toBe("two:committed")
    await drain()
    expect(container.textContent).toBe("two:success:two:committed|pending:0")
    expect(Effect.runSync(Ref.get(second.commits))).toBe(1)
  })

  it("reports typed failures through executeExit and state", async () => {
    class Reject extends Error {}
    const definition = Mutation.make<string, string, Reject>({
      name: "reject",
      execute: (input) => Effect.fail(new Reject(input))
    })
    const { client, dispose } = makeScopedClient()
    cleanups.push(() => void dispose())
    const handle = Effect.runSync(client.mutation(definition))
    let mutation!: ReturnType<typeof useMutation<string, string, Reject>>
    const View = defineComponent({
      setup(): () => VNode {
        mutation = useMutation(() => handle)
        return () => h("p", "ready")
      }
    })
    const container = document.createElement("div")
    document.body.append(container)
    const registry = AtomRegistry.make()
    render(h(Provider, { value: { label: "app" }, registry }, { default: () => [h(View)] }), container)
    cleanups.push(() => {
      render(null, container)
      container.remove()
      registry.dispose()
    })
    const exit = await mutation.executeExit("nope")
    expect(Exit.isFailure(exit)).toBe(true)
    if (!Exit.isFailure(exit)) return
    const failure = Cause.findErrorOption(exit.cause)
    expect(Option.isSome(failure) && failure.value.message).toBe("nope")
    await drain()
    await expect(mutation.execute("again")).rejects.toThrow("again")
    const state = await Effect.runPromise(handle.snapshot)
    expect(state.pendingCount).toBe(0)
    expect(state.latest._tag).toBe("Some")
  })

  it("binds saved effects to the handle selected when the action was called", async () => {
    const first = makeControlled("saved-first")
    const second = makeControlled("saved-second")
    const firstClient = makeScopedClient()
    cleanups.push(() => void firstClient.dispose())
    const firstHandle = Effect.runSync(firstClient.client.mutation(first.definition))
    const secondClient = makeScopedClient()
    cleanups.push(() => void secondClient.dispose())
    const secondHandle = Effect.runSync(secondClient.client.mutation(second.definition))
    let select!: (handle: MutationNS.Handle<string, string, never>) => void
    const { container, mutation } = mountMutation(firstHandle, (hook) => {
      select = hook
    })
    // Create every gate before any fiber reads it, then describe the actions on A.
    const gateOne = first.gateFor("one")
    const gateTwo = first.gateFor("two")
    const gateSolo = second.gateFor("solo")
    const savedExecute = mutation().executeEffect("one")
    const savedStart = mutation().startEffect("two")
    select(secondHandle)
    await drain()
    // Observation already follows B while the saved effects remain bound to A.
    expect(container.textContent).toBe("none|pending:0")
    const invocation = await Effect.runPromise(savedStart)
    await awaitDeferred(gateTwo.started)
    await succeed(gateTwo.release, undefined)
    expect(await Effect.runPromise(invocation.await)).toBe("two:committed")
    const savedCommitted = Effect.runPromise(savedExecute)
    await awaitDeferred(gateOne.started)
    await succeed(gateOne.release, undefined)
    expect(await savedCommitted).toBe("one:committed")
    expect(Effect.runSync(Ref.get(first.commits))).toBe(2)
    expect(Effect.runSync(Ref.get(second.commits))).toBe(0)
    // Actions described after the swap reach B.
    const solo = mutation().execute("solo")
    await awaitDeferred(gateSolo.started)
    await succeed(gateSolo.release, undefined)
    expect(await solo).toBe("solo:committed")
    await drain()
    expect(container.textContent).toBe("solo:success:solo:committed|pending:0")
    expect(Effect.runSync(Ref.get(second.commits))).toBe(1)
  })
})
