// @vitest-environment happy-dom
import { Mutation, Query } from "@effect-stack/query"
import { createQueryContext, useMutation, useQuery } from "@effect-stack/query-vue"
import type * as MutationNS from "@effect-stack/query/Mutation"
import { Deferred, Effect, Option, Ref } from "effect"
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry"
import { afterEach, describe, expect, it } from "vitest"
import { defineComponent, h, nextTick, reactive, ref, render, type VNode } from "vue"
import { formatResult, type Gate, gated, makeGate, makeScopedClient, rendererDrain } from "./harness.ts"

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
  readonly list: Query.Resource<string, never>
}

const { Provider, useQueryContext } = createQueryContext<App>()

const drain = async (): Promise<void> => {
  await rendererDrain()
  await nextTick()
}

const release = (gate: Gate): void => {
  Effect.runSync(Deferred.succeed(gate.release, undefined))
}

describe.sequential("Vue deep reactive sources", () => {
  it("shares one atom through plain refs, nested Options, and reactive App values", async () => {
    const gates = new Map<string, Gate>()
    let attempts = 0
    const { client, dispose } = makeScopedClient()
    cleanups.push(() => void dispose())
    const definition = Query.make<string, string, never>({
      name: "deep",
      staleTime: "1 hours",
      load: (key) =>
        Effect.gen(function*() {
          attempts += 1
          const attempt = attempts
          return yield* gated(gates.get(key)!, () => `${key}#${attempt}`)
        })
    })
    const family = client.query(definition)
    const first = family("first")
    const second = family("second")
    gates.set("first", makeGate())
    gates.set("second", makeGate())

    // A reactive App object hands out proxy-wrapped resources; plain refs deep-wrap too.
    const app = reactive<App>({ list: first })
    const selected = ref<Query.Resource<string, never> | Option.Option<Query.Resource<string, never>>>(first)
    const registry = AtomRegistry.make()
    cleanups.push(() => registry.dispose())
    const View = defineComponent({
      setup(): () => VNode {
        const context = useQueryContext()
        const byRef = useQuery(selected)
        const byApp = useQuery(() => context.value.list)
        return () => h("p", `${formatResult(byRef.value)}|${formatResult(byApp.value)}`)
      }
    })
    const container = document.createElement("div")
    document.body.append(container)
    render(h(Provider, { value: app, registry }, { default: () => [h(View)] }), container)
    await drain()
    expect(container.textContent).toBe("waiting|waiting")
    // Plain-ref and proxy-wrapped views unwrap to the same core resource: one lease.
    expect(attempts).toBe(1)
    release(gates.get("first")!)
    await drain()
    expect(container.textContent).toBe("success:first#1|success:first#1")
    expect(attempts).toBe(1)
    selected.value = Option.some(second)
    await drain()
    expect(attempts).toBe(2)
    release(gates.get("second")!)
    await drain()
    expect(container.textContent).toBe("success:second#2|success:first#1")
    selected.value = Option.none()
    await drain()
    expect(container.textContent).toBe("initial|success:first#1")
    render(null, container)
  })

  it("follows plain refs of mutation handles for state and actions", async () => {
    const { client, dispose } = makeScopedClient()
    cleanups.push(() => void dispose())
    const commits = Effect.runSync(Ref.make(0))
    const gates = new Map<string, Gate>()
    const makeDefinition = (name: string): Mutation.Mutation<string, string, never> =>
      Mutation.make<string, string, never>({
        name,
        execute: (input) =>
          Effect.gen(function*() {
            const gate = gates.get(`${name}:${input}`)!
            yield* Deferred.succeed(gate.started, undefined)
            yield* Deferred.await(gate.release)
            yield* Ref.update(commits, (count) => count + 1)
            return `${name}:${input}`
          })
      })
    const firstHandle = Effect.runSync(client.mutation(makeDefinition("first")))
    const secondHandle = Effect.runSync(client.mutation(makeDefinition("second")))
    gates.set("first:one", makeGate())
    gates.set("second:two", makeGate())
    // `ref` deep-wraps the handle; the hook must bind the original controller.
    const selected = ref<MutationNS.Handle<string, string, never>>(firstHandle)
    const registry = AtomRegistry.make()
    cleanups.push(() => registry.dispose())
    let mutation!: ReturnType<typeof useMutation<string, string, never>>
    const View = defineComponent({
      setup(): () => VNode {
        mutation = useMutation(selected)
        return () => h("p", String(mutation.state.value.pendingCount))
      }
    })
    const container = document.createElement("div")
    document.body.append(container)
    const app: App = {
      list: client.query(Query.make<string, string, never>({ name: "app-list", load: () => Effect.succeed("x") }))("x")
    }
    render(
      h(Provider, { value: app, registry }, { default: () => [h(View)] }),
      container
    )
    const one = mutation.execute("one")
    await Effect.runPromise(Deferred.await(gates.get("first:one")!.started))
    await drain()
    expect(container.textContent).toBe("1")
    // A swap through the deep ref repoints both observation and actions.
    selected.value = secondHandle
    await drain()
    expect(container.textContent).toBe("0")
    const two = mutation.execute("two")
    await Effect.runPromise(Deferred.await(gates.get("second:two")!.started))
    await drain()
    expect(container.textContent).toBe("1")
    release(gates.get("second:two")!)
    expect(await two).toBe("second:two")
    release(gates.get("first:one")!)
    expect(await one).toBe("first:one")
    await drain()
    expect(container.textContent).toBe("0")
    expect(Effect.runSync(Ref.get(commits))).toBe(2)
    render(null, container)
  })

  it("follows reactive store property replacement for query state and mutation actions", async () => {
    const { client, dispose } = makeScopedClient()
    cleanups.push(() => void dispose())
    // Gated query resources: one gate per attempt, consumed in registration order per key.
    const queryGates = new Map<string, Array<Gate>>()
    const consumed = new Map<string, number>()
    let totalLoads = 0
    const resource = client.query(
      Query.make<string, string, never>({
        name: "store-query",
        staleTime: "1 hours",
        load: (key) =>
          Effect.gen(function*() {
            totalLoads += 1
            const index = consumed.get(key) ?? 0
            consumed.set(key, index + 1)
            const gate = queryGates.get(key)![index]!
            return yield* gated(gate, () => `${key}#${String(index + 1)}`)
          })
      })
    )
    const pushGate = (key: string): Gate => {
      const list = queryGates.get(key) ?? []
      const gate = makeGate()
      list.push(gate)
      queryGates.set(key, list)
      return gate
    }
    // Controlled writes with per-input gates and independent commit counts.
    const makeController = (name: string) => {
      const commits = Effect.runSync(Ref.make(0))
      const gates = new Map<string, Gate>()
      const handle = Effect.runSync(
        client.mutation(
          Mutation.make<string, string, never>({
            name,
            execute: (input) =>
              Effect.gen(function*() {
                const gate = gates.get(input)!
                yield* Deferred.succeed(gate.started, undefined)
                yield* Deferred.await(gate.release)
                yield* Ref.update(commits, (count) => count + 1)
                return `${name}:${input}`
              })
          })
        )
      )
      const gateFor = (input: string): Gate => {
        const gate = makeGate()
        gates.set(input, gate)
        return gate
      }
      return { commits, gateFor, handle }
    }
    const oldGate = pushGate("old")
    const freshGate = pushGate("fresh")
    const first = makeController("store-first")
    const second = makeController("store-second")
    const gateX = first.gateFor("x")
    const gateY = second.gateFor("y")
    // One reactive store; both slots are replaced by plain property assignment.
    const store = reactive<{
      resource: Query.Resource<string, never>
      handle: MutationNS.Handle<string, string, never>
    }>({ resource: resource("old"), handle: first.handle })
    let query!: ReturnType<typeof useQuery<string, never>>
    let mutation!: ReturnType<typeof useMutation<string, string, never>>
    const View = defineComponent({
      setup(): () => VNode {
        query = useQuery(() => store.resource)
        mutation = useMutation(() => store.handle)
        return () => h("p", `${formatResult(query.value)}|${String(mutation.state.value.pendingCount)}`)
      }
    })
    const registry = AtomRegistry.make()
    cleanups.push(() => registry.dispose())
    const container = document.createElement("div")
    document.body.append(container)
    cleanups.push(() => container.remove())
    render(h(Provider, { value: { list: resource("unused") }, registry }, { default: () => [h(View)] }), container)
    await drain()
    expect(container.textContent).toBe("waiting|0")
    const writeX = mutation.execute("x")
    await Effect.runPromise(Deferred.await(gateX.started))
    await drain()
    expect(container.textContent).toBe("waiting|1")
    // Replace the query slot: the abandoned lease interrupts the old load.
    store.resource = resource("fresh")
    await drain()
    await Effect.runPromise(Deferred.await(oldGate.cancelled))
    expect(container.textContent).toBe("waiting|1")
    // Replace the mutation slot: state follows the new controller and pending resets.
    store.handle = second.handle
    await drain()
    expect(container.textContent).toBe("waiting|0")
    // The accepted old write still completes on its own controller.
    Effect.runSync(Deferred.succeed(gateX.release, undefined))
    expect(await writeX).toBe("store-first:x")
    expect(Effect.runSync(Ref.get(first.commits))).toBe(1)
    expect(Effect.runSync(Ref.get(second.commits))).toBe(0)
    // Actions described after the replacement reach the second controller.
    const writeY = mutation.execute("y")
    await Effect.runPromise(Deferred.await(gateY.started))
    await drain()
    expect(container.textContent).toBe("waiting|1")
    Effect.runSync(Deferred.succeed(gateY.release, undefined))
    expect(await writeY).toBe("store-second:y")
    expect(Effect.runSync(Ref.get(second.commits))).toBe(1)
    // And the query completes from the fresh resource only.
    Effect.runSync(Deferred.succeed(freshGate.release, undefined))
    await drain()
    expect(container.textContent).toBe("success:fresh#1|0")
    // Two selections, two loads: reactive property reads never duplicated interest.
    expect(totalLoads).toBe(2)
    render(null, container)
  })
})
