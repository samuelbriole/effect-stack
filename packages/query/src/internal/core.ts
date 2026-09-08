import * as Cause from "effect/Cause"
import * as Clock from "effect/Clock"
import type * as Context from "effect/Context"
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as FiberSet from "effect/FiberSet"
import * as MutableHashMap from "effect/MutableHashMap"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import * as Atom from "effect/unstable/reactivity/Atom"
import type * as Mutation from "../Mutation.ts"
import type * as Query from "../Query.ts"

type Listener<A> = (value: A) => void

const settled = <A, E>(state: AsyncResult.AsyncResult<A, E>): AsyncResult.AsyncResult<A, E> => {
  switch (state._tag) {
    case "Initial":
      return state.waiting ? AsyncResult.initial() : state
    case "Success":
      return state.waiting ? AsyncResult.success(state.value, { timestamp: state.timestamp }) : state
    case "Failure":
      return state.waiting ? AsyncResult.failure(state.cause, { previousSuccess: state.previousSuccess }) : state
  }
}

const interruptedCause = Cause.interrupt(0)

interface Request<A, E> {
  generation: number
  readonly deferred: Deferred.Deferred<A, E>
  fiber: Fiber.Fiber<A, E> | undefined
  cancelled: boolean
}

interface QueryEntry<I, A, E, R> {
  readonly definition: Query.Query<I, A, E, R>
  readonly input: I
  readonly context: Context.Context<R>
  readonly clock: Clock.Clock
  readonly launch: <X, XE>(effect: Effect.Effect<X, XE>) => Fiber.Fiber<X, XE>
  readonly coordinate: <X, XE>(effect: Effect.Effect<X, XE>) => Fiber.Fiber<X, XE>
  readonly reportListenerDefect: (defect: unknown) => void
  readonly isClosed: () => boolean
  readonly listeners: Set<Listener<AsyncResult.AsyncResult<A, E>>>
  state: AsyncResult.AsyncResult<A, E>
  generation: number
  settledGeneration: number
  active: Request<A, E> | undefined
  queued: Request<A, E> | undefined
  interests: number
  gcToken: number
  gcFiber: Fiber.Fiber<void> | undefined
  notificationVersion: number
  readonly onGc: () => void
}

const commitQuery = <I, A, E, R>(
  entry: QueryEntry<I, A, E, R>,
  value: AsyncResult.AsyncResult<A, E>
): number => {
  entry.state = value
  return ++entry.notificationVersion
}

const notifyQuery = <I, A, E, R>(
  entry: QueryEntry<I, A, E, R>,
  value: AsyncResult.AsyncResult<A, E>,
  version: number
): void => {
  const listeners = Array.from(entry.listeners)
  for (const listener of listeners) {
    if (entry.notificationVersion !== version) break
    if (!entry.listeners.has(listener)) continue
    try {
      listener(value)
    } catch (defect) {
      entry.reportListenerDefect(defect)
    }
  }
}

const publishQuery = <I, A, E, R>(entry: QueryEntry<I, A, E, R>, value: AsyncResult.AsyncResult<A, E>) => {
  notifyQuery(entry, value, commitQuery(entry, value))
}

const newRequest = <A, E>(generation: number): Request<A, E> => ({
  generation,
  deferred: Deferred.makeUnsafe<A, E>(),
  fiber: undefined,
  cancelled: false
})

const startRequest = <I, A, E, R>(entry: QueryEntry<I, A, E, R>, request: Request<A, E>): void => {
  if (entry.isClosed()) {
    Deferred.doneUnsafe(request.deferred, Effect.interrupt)
    return
  }
  entry.active = request
  publishQuery(entry, AsyncResult.waitingFrom(Option.some(entry.state)))
  const execution = Effect.suspend(() => entry.definition.load(entry.input)).pipe(
    Effect.provide(entry.context),
    Effect.scoped
  )
  const fiber = entry.launch(execution)
  request.fiber = fiber
  // Publication is a reentrancy boundary: the last observer may have released
  // this request before its execution fiber could be assigned.
  if (request.cancelled || entry.isClosed()) fiber.interruptUnsafe()
  entry.coordinate(Effect.gen(function*() {
    const exit = yield* Fiber.await(fiber)
    const now = Exit.isSuccess(exit) ? yield* entry.clock.currentTimeMillis : undefined
    completeRequest(entry, request, exit, now)
  }))
}

const completeRequest = <I, A, E, R>(
  entry: QueryEntry<I, A, E, R>,
  request: Request<A, E>,
  exit: Exit.Exit<A, E>,
  now: number | undefined
): void => {
  if (entry.active !== request) {
    Deferred.doneUnsafe(request.deferred, exit)
    return
  }
  entry.active = undefined
  const current = request.generation === entry.generation
  let publication: readonly [value: AsyncResult.AsyncResult<A, E>, version: number] | undefined
  if (entry.isClosed()) {
    if (Exit.isSuccess(exit) || !Cause.hasInterruptsOnly(exit.cause)) {
      entry.settledGeneration = request.generation
    }
    const value = AsyncResult.fromExitWithPrevious(exit, Option.some(entry.state))
    publication = [value, commitQuery(entry, value)]
  } else if (current) {
    if (Exit.isSuccess(exit)) {
      entry.settledGeneration = request.generation
      const value = AsyncResult.success(exit.value, { timestamp: now })
      publication = [value, commitQuery(entry, value)]
    } else if (!Cause.hasInterruptsOnly(exit.cause)) {
      entry.settledGeneration = request.generation
      const value = AsyncResult.fromExitWithPrevious(exit, Option.some(entry.state))
      publication = [value, commitQuery(entry, value)]
    } else {
      const value = settled(entry.state)
      publication = [value, commitQuery(entry, value)]
    }
  } else if (request.cancelled && entry.queued === undefined) {
    // Cancellation supersedes the generation immediately. Clear the waiting
    // flag after cleanup only when no replacement was accepted meanwhile.
    const value = settled(entry.state)
    publication = [value, commitQuery(entry, value)]
  }
  try {
    if (publication !== undefined) notifyQuery(entry, publication[0], publication[1])
  } finally {
    Deferred.doneUnsafe(request.deferred, exit)
  }
  startQueued(entry)
}

const startQueued = <I, A, E, R>(entry: QueryEntry<I, A, E, R>): void => {
  if (entry.isClosed() || entry.active !== undefined || entry.interests === 0) return
  const queued = entry.queued
  if (queued === undefined) return
  entry.queued = undefined
  queued.generation = entry.generation
  startRequest(entry, queued)
}

const requestFor = <I, A, E, R>(entry: QueryEntry<I, A, E, R>): Request<A, E> => {
  if (entry.active === undefined) {
    const request = entry.queued ?? newRequest<A, E>(entry.generation)
    entry.queued = undefined
    request.generation = entry.generation
    startRequest(entry, request)
    return request
  }
  if (entry.active.generation === entry.generation && !entry.active.cancelled) return entry.active
  if (entry.queued === undefined) entry.queued = newRequest<A, E>(entry.generation)
  else entry.queued.generation = entry.generation
  return entry.queued
}

const releaseInterest = <I, A, E, R>(entry: QueryEntry<I, A, E, R>): void => {
  entry.interests = Math.max(0, entry.interests - 1)
  if (entry.interests !== 0) return
  const active = entry.active
  if (active !== undefined && !active.cancelled) {
    active.cancelled = true
    entry.generation += 1
    active.fiber?.interruptUnsafe()
  }
  entry.queued = undefined
  const token = ++entry.gcToken
  entry.gcFiber?.interruptUnsafe()
  entry.gcFiber = undefined
  if (!Duration.isFinite(entry.definition.gcTime) || entry.isClosed()) return
  entry.gcFiber = entry.launch(
    entry.clock.sleep(entry.definition.gcTime).pipe(
      Effect.flatMap(() =>
        Effect.sync(() => {
          if (entry.interests === 0 && entry.gcToken === token) {
            entry.settledGeneration = -1
            entry.gcFiber = undefined
            entry.onGc()
            publishQuery(entry, AsyncResult.initial())
          }
        })
      )
    )
  )
}

const acquireInterest = <I, A, E, R>(entry: QueryEntry<I, A, E, R>): () => void => {
  entry.interests += 1
  entry.gcToken += 1
  entry.gcFiber?.interruptUnsafe()
  entry.gcFiber = undefined
  let released = false
  return () => {
    if (released) return
    released = true
    releaseInterest(entry)
  }
}

const invalidateEntry = <I, A, E, R>(entry: QueryEntry<I, A, E, R>): void => {
  entry.generation += 1
  if (entry.active !== undefined) {
    if (entry.queued === undefined) entry.queued = newRequest<A, E>(entry.generation)
    else entry.queued.generation = entry.generation
  }
  if (entry.interests > 0) {
    if (entry.active === undefined) requestFor(entry)
    else publishQuery(entry, AsyncResult.waitingFrom(Option.some(entry.state)))
  }
}

export interface ClientInternal<R> {
  readonly query: <I, A, E, R2 extends R | Scope.Scope>(
    definition: Query.Query<I, A, E, R2>
  ) => Query.Family<I, A, E>
  readonly mutation: <I, A, E, R2 extends R | Scope.Scope>(
    definition: Mutation.Mutation<I, A, E, R2>
  ) => Effect.Effect<Mutation.Handle<I, A, E>>
}

export const makeClient = <R>(context: Context.Context<R>): Effect.Effect<ClientInternal<R>, never, Scope.Scope> =>
  Effect.gen(function*() {
    let closed = false
    const clock = yield* Clock.Clock.pipe(Effect.provide(context))
    const shutdowns = new Set<() => Effect.Effect<void>>()
    const observerClosers = new Set<() => void>()
    const fibers = yield* FiberSet.make<unknown, unknown>()
    yield* Effect.addFinalizer(() =>
      Effect.gen(function*() {
        closed = true
        const actions = Array.from(shutdowns)
        shutdowns.clear()
        yield* Effect.forEach(actions, (shutdown) => shutdown(), { concurrency: "unbounded", discard: true })
        for (const closeObserver of observerClosers) closeObserver()
        observerClosers.clear()
      })
    )
    const launch = yield* FiberSet.runtime(fibers)<R>().pipe(Effect.provide(context))
    const coordinate = <X, XE>(effect: Effect.Effect<X, XE>): Fiber.Fiber<X, XE> => Effect.runForkWith(context)(effect)
    const reportListenerDefect = (defect: unknown): void => {
      coordinate(Effect.logError("Query observation listener threw", defect))
    }
    const ensureOpen = <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<A, E> =>
      Effect.suspend(() => closed ? Effect.interrupt : effect)
    const queryFamilies = new WeakMap<object, Query.Family<unknown, unknown, unknown>>()

    const query = <I, A, E, R2 extends R | Scope.Scope>(
      definition: Query.Query<I, A, E, R2>
    ): Query.Family<I, A, E> => {
      const existing = queryFamilies.get(definition)
      if (existing !== undefined) return existing as Query.Family<I, A, E>
      const entries = MutableHashMap.empty<I, QueryEntry<I, A, E, R2>>()
      const entryFor = (input: I): QueryEntry<I, A, E, R2> => {
        const found = MutableHashMap.get(entries, input)
        if (Option.isSome(found)) return found.value
        let entry: QueryEntry<I, A, E, R2>
        const shutdown = (): Effect.Effect<void> =>
          Effect.gen(function*() {
            entry.gcFiber?.interruptUnsafe()
            entry.gcFiber = undefined
            if (entry.queued !== undefined) Deferred.doneUnsafe(entry.queued.deferred, Effect.interrupt)
            entry.queued = undefined
            const active = entry.active
            if (active === undefined) {
              entry.settledGeneration = -1
              publishQuery(entry, AsyncResult.failure(interruptedCause))
            } else {
              active.fiber?.interruptUnsafe()
              // Completion is coordinated outside the FiberSet and settles this
              // deferred only after the execution scope and all finalizers close.
              yield* Deferred.await(active.deferred).pipe(Effect.exit)
            }
          })
        entry = {
          definition,
          input,
          context: context as Context.Context<R2>,
          clock,
          launch,
          coordinate,
          reportListenerDefect,
          isClosed: () => closed,
          listeners: new Set(),
          state: AsyncResult.initial(),
          generation: 0,
          settledGeneration: -1,
          active: undefined,
          queued: undefined,
          interests: 0,
          gcToken: 0,
          gcFiber: undefined,
          notificationVersion: 0,
          onGc: () => {
            const current = MutableHashMap.get(entries, input)
            if (Option.isSome(current) && current.value === entry) {
              MutableHashMap.remove(entries, input)
              shutdowns.delete(shutdown)
            }
          }
        }
        shutdowns.add(shutdown)
        MutableHashMap.set(entries, input, entry)
        return entry
      }
      const resources = Atom.family((input: I): Query.Resource<A, E> => {
        const current = () => entryFor(input)
        const peek = () => MutableHashMap.get(entries, input)
        const absentSnapshot = AsyncResult.initial<A, E>()
        const closedSnapshot = AsyncResult.failure<A, E>(interruptedCause)
        const getSnapshot = (): AsyncResult.AsyncResult<A, E> => {
          const entry = peek()
          if (Option.isSome(entry)) return entry.value.state
          return closed ? closedSnapshot : absentSnapshot
        }
        const invalidateObserved = (): void => {
          if (closed) return
          const entry = peek()
          if (Option.isSome(entry)) invalidateEntry(entry.value)
        }
        const observe = (listener: Listener<AsyncResult.AsyncResult<A, E>>): () => void => {
          if (closed) {
            try {
              listener(getSnapshot())
            } catch (defect) {
              reportListenerDefect(defect)
            }
            return () => {}
          }
          const entry = current()
          const release = acquireInterest(entry)
          let released = false
          const close = () => {
            if (released) return
            released = true
            entry.listeners.delete(listener)
            release()
            observerClosers.delete(close)
          }
          // Attach before activation because request publication is synchronous.
          entry.listeners.add(listener)
          observerClosers.add(close)
          const now = entry.clock.currentTimeMillisUnsafe()
          if (
            entry.state._tag !== "Success" ||
            entry.settledGeneration !== entry.generation ||
            now - entry.state.timestamp >= Duration.toMillis(definition.staleTime)
          ) requestFor(entry)
          return close
        }
        const get = ensureOpen(Effect.acquireUseRelease(
          Effect.sync(() => {
            const entry = current()
            const release = acquireInterest(entry)
            const active = entry.active
            if (active !== undefined && !active.cancelled && active.generation === entry.generation) {
              return { _tag: "Request" as const, release, request: active }
            }
            const now = entry.clock.currentTimeMillisUnsafe()
            if (
              entry.state._tag === "Success" &&
              entry.settledGeneration === entry.generation &&
              now - entry.state.timestamp < Duration.toMillis(definition.staleTime)
            ) {
              return { _tag: "Value" as const, release, value: entry.state.value }
            }
            return { _tag: "Request" as const, release, request: requestFor(entry) }
          }),
          (ticket) => ticket._tag === "Value" ? Effect.succeed(ticket.value) : Deferred.await(ticket.request.deferred),
          (ticket) => Effect.sync(ticket.release)
        ))
        const refresh = ensureOpen(Effect.acquireUseRelease(
          Effect.sync(() => {
            const entry = current()
            const release = acquireInterest(entry)
            const active = entry.active
            if (active !== undefined && !active.cancelled && active.generation === entry.generation) {
              return { release, request: active }
            }
            // Refresh callers arriving during accepted work share its queued
            // replacement; only the first advances an idle generation.
            if (entry.active === undefined && entry.queued === undefined) entry.generation += 1
            return { release, request: requestFor(entry) }
          }),
          (ticket) => Deferred.await(ticket.request.deferred),
          (ticket) => Effect.sync(ticket.release)
        ))
        const invalidate = ensureOpen(Effect.sync(invalidateObserved))
        const snapshot = ensureOpen(Effect.sync(getSnapshot))
        const changes = Stream.callback<AsyncResult.AsyncResult<A, E>>((queue) =>
          Effect.suspend(() =>
            closed ?
              Effect.sync(() => {
                Queue.failCauseUnsafe(queue, interruptedCause)
                return () => {}
              }) :
              Effect.acquireRelease(
                Effect.sync(() => {
                  const entry = current()
                  const release = acquireInterest(entry)
                  const listener = (value: AsyncResult.AsyncResult<A, E>) => Queue.offerUnsafe(queue, value)
                  let released = false
                  const close = (interrupt: boolean) => {
                    if (released) return
                    released = true
                    entry.listeners.delete(listener)
                    release()
                    observerClosers.delete(closeObserver)
                    if (interrupt) Queue.failCauseUnsafe(queue, interruptedCause)
                  }
                  const closeObserver = () => close(true)
                  entry.listeners.add(listener)
                  observerClosers.add(closeObserver)
                  Queue.offerUnsafe(queue, entry.state)
                  const now = entry.clock.currentTimeMillisUnsafe()
                  if (
                    entry.state._tag !== "Success" ||
                    entry.settledGeneration !== entry.generation ||
                    now - entry.state.timestamp >= Duration.toMillis(definition.staleTime)
                  ) requestFor(entry)
                  return () => close(false)
                }),
                (release) => Effect.sync(release)
              )
          )
        )
        const observation: Query.Observation<A, E> = { getSnapshot, observe, invalidate: invalidateObserved }
        const resource: Query.Resource<A, E> = { get, refresh, invalidate, snapshot, changes, observation }
        return resource
      })
      const family = Object.assign((input: I) => resources(input), {
        invalidate: ensureOpen(Effect.sync(() => {
          for (const [, entry] of entries) invalidateEntry(entry)
        }))
      })
      queryFamilies.set(definition, family as Query.Family<unknown, unknown, unknown>)
      return family
    }

    return {
      query,
      mutation: (definition) =>
        ensureOpen(
          makeMutation(definition, context, launch, coordinate, ensureOpen, shutdowns, observerClosers, () => closed)
        )
    }
  })

const makeMutation = <R, I, A, E, R2 extends R | Scope.Scope>(
  definition: Mutation.Mutation<I, A, E, R2>,
  context: Context.Context<R>,
  launch: <X, XE>(effect: Effect.Effect<X, XE>) => Fiber.Fiber<X, XE>,
  coordinate: <X, XE>(effect: Effect.Effect<X, XE>) => Fiber.Fiber<X, XE>,
  ensureOpen: <X, XE>(effect: Effect.Effect<X, XE>) => Effect.Effect<X, XE>,
  shutdowns: Set<() => Effect.Effect<void>>,
  observerClosers: Set<() => void>,
  isClosed: () => boolean
): Effect.Effect<Mutation.Handle<I, A, E>> =>
  Effect.sync(() => {
    let sequence = 0
    let state: Mutation.State<I, A, E> = { latest: Option.none(), pendingCount: 0 }
    const listeners = new Set<Listener<Mutation.State<I, A, E>>>()
    let notificationVersion = 0
    const commit = (next: Mutation.State<I, A, E>): number => {
      state = next
      return ++notificationVersion
    }
    const notify = (next: Mutation.State<I, A, E>, version: number): void => {
      const snapshot = Array.from(listeners)
      for (const listener of snapshot) {
        if (notificationVersion !== version) break
        if (!listeners.has(listener)) continue
        try {
          listener(next)
        } catch (defect) {
          coordinate(Effect.logError("Mutation observation listener threw", defect))
        }
      }
    }
    const start = (input: I): Effect.Effect<Mutation.Invocation<A, E>> =>
      ensureOpen(Effect.sync(() => {
        const id = ++sequence as unknown as Mutation.InvocationId
        const pending = {
          latest: Option.some({ id, input, result: AsyncResult.initial(true) }),
          pendingCount: state.pendingCount + 1
        }
        const pendingVersion = commit(pending)
        const completion = Deferred.makeUnsafe<A, E>()
        const effect = Effect.suspend(() => definition.execute(input)).pipe(
          Effect.provide(context as Context.Context<R2>),
          Effect.scoped
        )
        let fiber: Fiber.Fiber<A, E> | undefined
        let cancelled = false
        const shutdown = (): Effect.Effect<void> =>
          Effect.sync(() => {
            cancelled = true
            fiber?.interruptUnsafe()
          }).pipe(
            Effect.andThen(Deferred.await(completion).pipe(Effect.exit)),
            Effect.asVoid
          )
        shutdowns.add(shutdown)
        fiber = launch(effect)
        if (cancelled || isClosed()) fiber.interruptUnsafe()
        const executionFiber = fiber
        coordinate(
          Fiber.await(executionFiber).pipe(Effect.flatMap((exit) =>
            Effect.sync(() => {
              const latest = Option.isSome(state.latest) && state.latest.value.id === id
                ? Option.some({
                  id,
                  input,
                  result: AsyncResult.fromExitWithPrevious(exit, Option.some(state.latest.value.result))
                })
                : state.latest
              const next = { latest, pendingCount: Math.max(0, state.pendingCount - 1) }
              const version = commit(next)
              shutdowns.delete(shutdown)
              try {
                notify(next, version)
              } finally {
                Deferred.doneUnsafe(completion, exit)
              }
            })
          ))
        )
        notify(pending, pendingVersion)
        const interrupt = Fiber.interrupt(executionFiber).pipe(
          Effect.andThen(Deferred.await(completion).pipe(Effect.exit)),
          Effect.asVoid
        )
        return { id, await: Deferred.await(completion), interrupt }
      }))
    const getSnapshot = (): Mutation.State<I, A, E> => state
    const observe = (listener: Listener<Mutation.State<I, A, E>>): () => void => {
      if (isClosed()) {
        try {
          listener(state)
        } catch (defect) {
          coordinate(Effect.logError("Mutation observation listener threw", defect))
        }
        return () => {}
      }
      let released = false
      const close = () => {
        if (released) return
        released = true
        listeners.delete(listener)
        observerClosers.delete(close)
      }
      listeners.add(listener)
      observerClosers.add(close)
      return close
    }
    const observation: Mutation.Observation<I, A, E> = { getSnapshot, observe }
    const handle: Mutation.Handle<I, A, E> = {
      start,
      execute: (input) => start(input).pipe(Effect.flatMap((invocation) => invocation.await)),
      snapshot: ensureOpen(Effect.sync(() => state)),
      changes: Stream.callback((queue) =>
        Effect.suspend(() =>
          isClosed() ?
            Effect.sync(() => {
              Queue.failCauseUnsafe(queue, interruptedCause)
              return () => {}
            }) :
            Effect.acquireRelease(
              Effect.sync(() => {
                const listener = (value: Mutation.State<I, A, E>) => Queue.offerUnsafe(queue, value)
                let released = false
                const close = (interrupt: boolean) => {
                  if (released) return
                  released = true
                  listeners.delete(listener)
                  observerClosers.delete(closeObserver)
                  if (interrupt) Queue.failCauseUnsafe(queue, interruptedCause)
                }
                const closeObserver = () => close(true)
                listeners.add(listener)
                observerClosers.add(closeObserver)
                Queue.offerUnsafe(queue, state)
                return () => close(false)
              }),
              (release) => Effect.sync(release)
            )
        )
      ),
      observation
    }
    return handle
  })
