// Shared harness for @effect-stack/query renderer integration tests.
//
// Exercises the documented public API through the official Atom renderer hooks:
// a scoped client from `QueryClient.makeWith`, one load shared by two mounted
// observers, pending/success transitions, mutation invalidation reflected in
// both renderers, last-interest release interrupting unfinished work on
// unmount, and the client-scope shutdown barrier that finalizes outstanding
// loads and mutations before borrowed services are released.
//
// Coordination is exclusively Deferred/Queue based plus renderer flush
// utilities; there are no sleeps.
import { Mutation, Query, QueryAtom, QueryClient } from "@effect-stack/query"
import { Context, Deferred, Effect, Layer, Option, Queue } from "effect"
import { AtomRegistry } from "effect/unstable/reactivity"
import type * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import type * as Atom from "effect/unstable/reactivity/Atom"
import { expect } from "vitest"

/**
 * One loader invocation published for the renderers (and later phases) to
 * release deterministically. `finalize` signals when that attempt's request
 * scope has run its finalizers, however the attempt ended.
 */
export interface LoadRequest {
  readonly attempt: number
  readonly input: string
  readonly release: Deferred.Deferred<string>
}

export interface QueryTestControl {
  readonly requests: Queue.Queue<LoadRequest>
  readonly order: Array<string>
  readonly renameStarted: Deferred.Deferred<void>
  readonly renameGate: Deferred.Deferred<void>
  readonly archiveStarted: Deferred.Deferred<void>
  readonly nextAttempt: () => number
  readonly attempts: () => number
  readonly finalize: (attempt: number) => void
  readonly awaitFinalized: (attempt: number) => Promise<void>
}

const makeControl: Effect.Effect<QueryTestControl> = Effect.gen(function*() {
  const requests = yield* Queue.unbounded<LoadRequest>()
  const renameStarted = yield* Deferred.make<void>()
  const renameGate = yield* Deferred.make<void>()
  const archiveStarted = yield* Deferred.make<void>()
  const order: Array<string> = []
  const waiters = new Map<number, Set<() => void>>()
  let attempts = 0
  return {
    requests,
    order,
    renameStarted,
    renameGate,
    archiveStarted,
    nextAttempt: () => ++attempts,
    attempts: () => attempts,
    finalize: (attempt) => {
      order.push(`load-${attempt}:finalized`)
      const pending = waiters.get(attempt)
      if (pending !== undefined) {
        waiters.delete(attempt)
        for (const resolve of pending) {
          resolve()
        }
      }
    },
    awaitFinalized: (attempt) =>
      new Promise<void>((resolve) => {
        if (order.includes(`load-${attempt}:finalized`)) {
          resolve()
          return
        }
        const pending = waiters.get(attempt) ?? new Set()
        waiters.set(attempt, pending)
        pending.add(resolve)
      })
  }
})

class Connection extends Context.Service<Connection, { readonly id: string }>()("integration/Connection") {}

const makeApp = Effect.gen(function*() {
  const control = yield* makeControl
  // Borrowed services must outlive the client, so they are built in the
  // surrounding application scope before the client acquires from them.
  const services = yield* Layer.build(
    Layer.effect(
      Connection,
      Effect.acquireRelease(
        Effect.sync(() => Connection.of({ id: "shared" })),
        () =>
          Effect.sync(() => {
            control.order.push("connection-released")
          })
      )
    )
  )
  const userQuery = Query.make({
    name: "integration/users.detail",
    staleTime: "1 hour",
    load: Effect.fn("integration/users.detail")(function*(input: string) {
      const attempt = control.nextAttempt()
      const release = yield* Deferred.make<string>()
      yield* Queue.offer(control.requests, { attempt, input, release })
      yield* Effect.addFinalizer(() => Effect.sync(() => control.finalize(attempt)))
      return yield* Deferred.await(release)
    })
  })
  const client = yield* QueryClient.makeWith(services)
  const users = client.query(userQuery)
  const rename = yield* client.mutation(Mutation.make({
    name: "integration/users.rename",
    execute: Effect.fn("integration/users.rename")(function*(name: string) {
      yield* Deferred.succeed(control.renameStarted, undefined)
      yield* Deferred.await(control.renameGate)
      yield* users("ada").invalidate
      return name
    })
  }))
  const archive = yield* client.mutation(Mutation.make({
    name: "integration/users.archive",
    execute: Effect.fn("integration/users.archive")(function*(input: string) {
      yield* Deferred.succeed(control.archiveStarted, undefined)
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          control.order.push(`archive-${input}:finalized`)
        })
      )
      return yield* Effect.never
    })
  }))
  return { client, control, users, rename, archive }
})

export type QueryTestApp = Effect.Success<typeof makeApp>

export const formatResult = (result: AsyncResult.AsyncResult<string>): string =>
  result._tag === "Success" ? result.value : result._tag === "Failure" ? "error" : "loading"

export const formatState = (state: Mutation.State<string, string, never>): string => {
  if (state.pendingCount > 0) {
    return `pending:${state.pendingCount}`
  }
  if (Option.isSome(state.latest) && state.latest.value.result._tag === "Success") {
    return `done:${state.latest.value.result.value}`
  }
  return "idle"
}

export interface ScenarioAtoms {
  readonly user: Atom.Atom<AsyncResult.AsyncResult<string>>
  readonly bruce: Atom.Atom<AsyncResult.AsyncResult<string>>
  readonly rename: Atom.Atom<Mutation.State<string, string, never>>
}

export type ScenarioSection = "user-a" | "user-b" | "bruce" | "rename"

export interface RendererView {
  readonly text: (section: ScenarioSection) => string
  /** Drains registry notifications and renderer work without sleeping. */
  readonly flush: () => Promise<void>
  /**
   * Runs a trigger that can schedule state updates inside a single renderer
   * work cycle (React.act for the React adapter), then drains it.
   */
  readonly update: <T>(trigger: () => T | Promise<T>) => Promise<Awaited<T>>
  /** Waits for the AsyncResult atom to settle, then flushes the renderer. */
  readonly settle: (atom: ScenarioAtoms["user"]) => Promise<void>
  readonly unmount: () => Promise<void>
}

export interface RendererAdapter {
  readonly name: string
  readonly mount: (
    registry: AtomRegistry.AtomRegistry,
    atoms: ScenarioAtoms
  ) => RendererView | Promise<RendererView>
}

export const runScenario = async (app: QueryTestApp, renderer: RendererAdapter): Promise<void> => {
  const { control } = app
  const registry = AtomRegistry.make()
  const atoms: ScenarioAtoms = {
    user: QueryAtom.query(app.users("ada")),
    bruce: QueryAtom.query(app.users("bruce")),
    rename: QueryAtom.mutation(app.rename)
  }
  const view = await renderer.mount(registry, atoms)
  try {
    // Phase 1: two mounted observers on one resource share a single load.
    const [first, second] = await Effect.runPromise(
      Effect.all([Queue.take(control.requests), Queue.take(control.requests)])
    )
    const [ada, bruce] = [first, second].sort((left, right) => left.input.localeCompare(right.input))
    expect(ada.input).toBe("ada")
    expect(bruce.input).toBe("bruce")
    expect(control.attempts()).toBe(2)

    await view.flush()
    expect(view.text("user-a")).toBe("loading")
    expect(view.text("user-b")).toBe("loading")
    expect(view.text("bruce")).toBe("loading")
    expect(view.text("rename")).toBe("idle")
    // Mounted hooks must observe through the registry the scenario provides.
    expect(registry.getNodes().has(atoms.user)).toBe(true)
    expect(registry.getNodes().has(atoms.rename)).toBe(true)

    await view.update(() => Effect.runPromise(Deferred.succeed(ada.release, "Ada v1")))
    await view.settle(atoms.user)
    expect(view.text("user-a")).toBe("Ada v1")
    expect(view.text("user-b")).toBe("Ada v1")
    expect(await Effect.runPromise(Queue.size(control.requests))).toBe(0)
    expect(control.attempts()).toBe(2)

    // Phase 2: the mutation's committed invalidation revalidates for both.
    const rename = await view.update(() => ({ done: Effect.runPromise(app.rename.execute("Grace")) }))
    await view.update(() => Effect.runPromise(Deferred.await(control.renameStarted)))
    expect(view.text("rename")).toBe("pending:1")
    expect(view.text("user-a")).toBe("Ada v1")

    await view.update(() => Effect.runPromise(Deferred.succeed(control.renameGate, undefined)))
    expect(await view.update(() => rename.done)).toBe("Grace")
    expect(view.text("rename")).toBe("done:Grace")

    const revalidation = await Effect.runPromise(Queue.take(control.requests))
    expect(revalidation.input).toBe("ada")
    expect(control.attempts()).toBe(3)
    await view.flush()
    // Observers keep the previous success while the stale resource revalidates.
    expect(view.text("user-a")).toBe("Ada v1")
    expect(view.text("user-b")).toBe("Ada v1")

    await view.update(() => Effect.runPromise(Deferred.succeed(revalidation.release, "Grace v2")))
    await view.settle(atoms.user)
    expect(view.text("user-a")).toBe("Grace v2")
    expect(view.text("user-b")).toBe("Grace v2")

    // Snapshot samples the same authoritative state through a fresh handle
    // without starting work or retaining observation interest.
    const snapshot = await Effect.runPromise(app.users("ada").snapshot)
    expect(snapshot._tag).toBe("Success")
    if (snapshot._tag === "Success") {
      expect(snapshot.value).toBe("Grace v2")
    }
    expect(await Effect.runPromise(Queue.size(control.requests))).toBe(0)

    // Phase 3: unmounting the last observer releases the bruce interest and
    // interrupts its unfinished load before any application scope closes.
    expect(view.text("bruce")).toBe("loading")
    await view.unmount()
    await control.awaitFinalized(bruce.attempt)
    expect(control.order).toContain(`load-${bruce.attempt}:finalized`)
  } finally {
    await view.unmount()
    registry.dispose()
  }
}

export interface IntegrationOutcome {
  readonly order: ReadonlyArray<string>
  readonly carolAttempt: number
}
export const runFamilyInvalidationScenario = async (app: QueryTestApp, renderer: RendererAdapter): Promise<void> => {
  const { control } = app
  const registry = AtomRegistry.make()
  const atoms: ScenarioAtoms = {
    user: QueryAtom.query(app.users("ada")),
    bruce: QueryAtom.query(app.users("bruce")),
    rename: QueryAtom.mutation(app.rename)
  }
  const view = await renderer.mount(registry, atoms)
  try {
    const [first, second] = await Effect.runPromise(
      Effect.all([Queue.take(control.requests), Queue.take(control.requests)])
    )
    await view.update(() =>
      Effect.runPromise(Effect.all([
        Deferred.succeed(first.release, `${first.input} v1`),
        Deferred.succeed(second.release, `${second.input} v1`)
      ]))
    )
    await view.settle(atoms.user)
    await view.settle(atoms.bruce)
    expect(view.text("user-a")).toBe("ada v1")
    expect(view.text("bruce")).toBe("bruce v1")
    expect(control.attempts()).toBe(2)

    // Family-level invalidation marks every instantiated input stale and
    // schedules one coalesced revalidation per actively observed input.
    await view.update(() => Effect.runPromise(app.users.invalidate))
    const [third, fourth] = await Effect.runPromise(
      Effect.all([Queue.take(control.requests), Queue.take(control.requests)])
    )
    expect([third.input, fourth.input].sort()).toEqual(["ada", "bruce"])
    expect(control.attempts()).toBe(4)
    await view.update(() =>
      Effect.runPromise(Effect.all([
        Deferred.succeed(third.release, `${third.input} v2`),
        Deferred.succeed(fourth.release, `${fourth.input} v2`)
      ]))
    )
    await view.settle(atoms.user)
    await view.settle(atoms.bruce)
    expect(view.text("user-a")).toBe("ada v2")
    expect(view.text("user-b")).toBe("ada v2")
    expect(view.text("bruce")).toBe("bruce v2")
  } finally {
    await view.unmount()
    registry.dispose()
  }
}

export const runFamilyInvalidation = (renderer: RendererAdapter): Effect.Effect<void> =>
  Effect.scoped(Effect.gen(function*() {
    const app = yield* makeApp
    yield* Effect.promise(() => runFamilyInvalidationScenario(app, renderer))
  }))

export const runQueryIntegration = (renderer: RendererAdapter): Effect.Effect<IntegrationOutcome> =>
  Effect.scoped(Effect.gen(function*() {
    const app = yield* makeApp
    yield* Effect.promise(() => runScenario(app, renderer))
    // Phase 4: client shutdown is the barrier. A reader without any renderer
    // interest and an accepted mutation both interrupt and finalize there,
    // before borrowed services release.
    yield* Effect.forkScoped(app.users("carol").get)
    const carol = yield* Queue.take(app.control.requests)
    yield* app.archive.start("carol")
    yield* Deferred.await(app.control.archiveStarted)
    return { order: app.control.order, carolAttempt: carol.attempt }
  }))

export const expectFinalizationBarrier = (outcome: IntegrationOutcome): void => {
  const { carolAttempt, order } = outcome
  const trace = order.join(", ")
  expect(order.at(-1), `Connection must release last, after the client barrier: ${trace}`).toBe(
    "connection-released"
  )
  const releaseIndex = order.lastIndexOf("connection-released")
  expect(
    order.indexOf(`load-${carolAttempt}:finalized`),
    `Unfinished reader load must finalize before services release: ${trace}`
  ).toBeGreaterThanOrEqual(0)
  expect(order.indexOf(`load-${carolAttempt}:finalized`)).toBeLessThan(releaseIndex)
  expect(
    order.indexOf("archive-carol:finalized"),
    `Accepted mutation must finalize before services release: ${trace}`
  ).toBeGreaterThanOrEqual(0)
  expect(order.indexOf("archive-carol:finalized")).toBeLessThan(releaseIndex)
}
