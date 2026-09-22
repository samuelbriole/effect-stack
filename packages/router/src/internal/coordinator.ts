/**
 * Navigation coordinator: authoritative snapshot, attempts, history protocol,
 * scoped preparation, and publication. Internal module.
 *
 * @since 0.4.0
 */
import * as Cause from "effect/Cause"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as Ref from "effect/Ref"
import * as Result from "effect/Result"
import type * as Scope from "effect/Scope"
import * as Semaphore from "effect/Semaphore"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import type { Compiled, DecodedInput, Plan } from "./compiler.ts"
import type { Destination, RuntimeNode } from "./contract.ts"
import { RouteDefinitionError, RouteEncodeError, RouteNotFound } from "./errors.ts"
import * as History from "../History.ts"
import { isRedirect } from "./redirect.ts"
import { encode } from "./url.ts"

/** Terminal outcomes of an accepted navigation attempt. @since 0.4.0 */
export type NavigationOutcome = "Committed" | "Superseded" | "Cancelled"

/** A retained, internally consistent presentation pair. @since 0.4.0 */
export interface RetainedValue {
  readonly input: DecodedInput
  readonly data: unknown
}

/** One node in a presentation. @since 0.4.0 */
export interface EntryState {
  readonly node: RuntimeNode
  readonly id: string
  readonly input: Result.Result<DecodedInput, unknown>
  readonly data: AsyncResult.AsyncResult<unknown, unknown>
  readonly retained: Option.Option<RetainedValue>
}

/** A destination-associated failure. @since 0.4.0 */
export type Presentation =
  | {
      readonly _tag: "Pending"
      readonly attempt: number
      readonly location: History.Location
      readonly entries: ReadonlyArray<EntryState>
    }
  | {
      readonly _tag: "Resolved"
      readonly attempt: number
      readonly location: History.Location
      readonly entries: ReadonlyArray<EntryState>
    }
  | {
      readonly _tag: "Failed"
      readonly attempt: number
      readonly location: History.Location
      readonly owner: string
      readonly error: unknown
      readonly entries: ReadonlyArray<EntryState>
    }

/** The latest command's command-level status. @since 0.4.0 */
export type NavigationStatus =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Pending"; readonly attempt: number }
  | { readonly _tag: "Committed"; readonly attempt: number }
  | { readonly _tag: "Superseded"; readonly attempt: number }
  | { readonly _tag: "Cancelled"; readonly attempt: number }
  | { readonly _tag: "Rejected"; readonly error: unknown }
  | { readonly _tag: "Failed"; readonly attempt: number; readonly owner: string; readonly error: unknown }

/** A fully successful branch. @since 0.4.0 */
export interface ResolvedBranch {
  readonly attempt: number
  readonly location: History.Location
  readonly entries: ReadonlyArray<EntryState>
}

/** The authoritative router snapshot. @since 0.4.0 */
export interface Snapshot {
  readonly location: Option.Option<History.Location>
  readonly status: NavigationStatus
  readonly presentation: Option.Option<Presentation>
  readonly resolved: Option.Option<ResolvedBranch>
}

/** A route or group implementation captured at construction. @since 0.4.0 */
export interface RouteImplementation {
  readonly node: RuntimeNode
  readonly run: (input: unknown) => Effect.Effect<unknown, unknown, Scope.Scope>
}

/** A navigation attempt handle. @since 0.4.0 */
export interface NavigationHandle {
  readonly id: number
  readonly await: Effect.Effect<NavigationOutcome, unknown>
  readonly cancel: Effect.Effect<void>
}

/** Options accepted by navigation commands. @since 0.4.0 */
export interface NavigateOptions {
  readonly replace?: boolean
  readonly state?: unknown
}

/** The coordinator surface consumed by the Router service. @since 0.4.0 */
export interface Coordinator {
  readonly snapshot: SubscriptionRef.SubscriptionRef<Snapshot>
  readonly awaitInitial: Effect.Effect<void, unknown>
  readonly navigate: (destination: Destination, options?: NavigateOptions) => Effect.Effect<NavigationOutcome, unknown>
  readonly submit: (destination: Destination, options?: NavigateOptions) => Effect.Effect<NavigationHandle, unknown>
  readonly refresh: Effect.Effect<NavigationOutcome, unknown>
  readonly retry: Effect.Effect<NavigationOutcome, unknown>
  readonly back: Effect.Effect<void, History.HistoryError>
  readonly forward: Effect.Effect<void, History.HistoryError>
  readonly go: (delta: number) => Effect.Effect<void, History.HistoryError>
}

const MAX_REDIRECTS = 20

/** @since 0.4.0 */
export const initialSnapshot: Snapshot = {
  location: Option.none(),
  status: { _tag: "Idle" },
  presentation: Option.none(),
  resolved: Option.none()
}

interface ActiveAttempt {
  readonly id: number
  readonly status: Ref.Ref<"running" | "superseded" | "cancelled">
  readonly ready: Deferred.Deferred<void>
  readonly outcome: Deferred.Deferred<NavigationOutcome, unknown>
  readonly initial: History.Location
  fiber: Fiber.Fiber<void>
}

const handlerInput = (decoded: DecodedInput): unknown => ({
  params: decoded.params,
  search: decoded.search,
  hash: decoded.hash,
  location: decoded.location
})

const firstFailure = (cause: Cause.Cause<unknown>): unknown => {
  for (const reason of cause.reasons) {
    if (Cause.isFailReason(reason)) return reason.error
  }
  return undefined
}

const findRedirect = (cause: Cause.Cause<unknown>): Destination | undefined => {
  // Only a pure single redirect failure is consumed. A cause that also carries
  // a defect or finalizer failure (for example a redirect raised while a scoped
  // release dies) must stay a failure so the combined Cause is preserved.
  if (cause.reasons.length !== 1) return undefined
  const reason = cause.reasons[0]
  if (reason === undefined || !Cause.isFailReason(reason)) return undefined
  return isRedirect(reason.error) ? (reason.error.destination as Destination) : undefined
}

/** Owner recorded for a router-level failure that is not an unmatched URL. @since 0.4.0 */
export const RouterFailureOwner = "<router>"
/** Owner recorded when no configured route matched the observed URL. @since 0.4.0 */
export const NotFoundFailureOwner = "<notfound>"

type AttemptResult =
  | {
      readonly _tag: "Success"
      readonly location: History.Location
      readonly entries: ReadonlyArray<EntryState>
    }
  | { readonly _tag: "Superseded" }
  | {
      readonly _tag: "Failure"
      readonly location: History.Location
      readonly owner: string
      readonly cause: Cause.Cause<unknown>
      readonly entries: ReadonlyArray<EntryState>
    }

type PrepareOutcome =
  | { readonly _tag: "Prepared"; readonly entries: ReadonlyArray<EntryState> }
  | { readonly _tag: "Redirect"; readonly destination: Destination }
  | {
      readonly _tag: "Failed"
      readonly owner: string
      readonly cause: Cause.Cause<unknown>
      readonly entries: ReadonlyArray<EntryState>
    }

const entriesOf = (presentation: Presentation | undefined): ReadonlyArray<EntryState> =>
  presentation === undefined ? [] : presentation.entries

const failedEntry = (
  node: RuntimeNode,
  input: Result.Result<DecodedInput, unknown>,
  cause: Cause.Cause<unknown>
): EntryState => ({
  node,
  id: node.id,
  input,
  data: AsyncResult.failure(cause),
  retained: Option.none()
})

/**
 * Builds the navigation coordinator over a compiled contract and history.
 *
 * @since 0.4.0
 * @category constructors
 */
export const make = Effect.fn("Router.coordinator")(function* (
  compiled: Compiled,
  implementations: ReadonlyMap<string, RouteImplementation>
): Effect.fn.Return<Coordinator, never, History.Service | Scope.Scope> {
  const history = yield* History.Service
  const self = yield* Effect.scope
  const snapshot = yield* SubscriptionRef.make<Snapshot>(initialSnapshot)
  const nextId = yield* Ref.make(0)
  const active = yield* Ref.make<Option.Option<ActiveAttempt>>(Option.none())
  const acceptance = yield* Semaphore.make(1)
  const allocateId = Ref.updateAndGet(nextId, (value) => value + 1)

  const isAuthorized = (id: number): Effect.Effect<boolean> =>
    Ref.get(active).pipe(Effect.map((current) => Option.isSome(current) && current.value.id === id))

  // Destination membership is resolved against the canonical runtime nodes:
  // a foreign contract can share a qualified id but never the node reference.
  const isMember = (node: { readonly id: string }): boolean =>
    compiled.byId.get(node.id) === (node as unknown as RuntimeNode)
  const foreignDestinationError = (node: { readonly id: string }): RouteEncodeError =>
    new RouteEncodeError({
      routeId: node.id,
      part: "path",
      message: "Destination does not belong to this router collection"
    })

  // Every ownership check and snapshot publication transition is serialized by
  // this gate. No user handler or finalizer ever runs inside it, so awaiting a
  // fiber that itself publishes (for example during interruption) cannot
  // deadlock.
  const gate = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> => acceptance.withPermits(1)(effect)

  const acceptUnsafe = (attempt: number, location: History.Location, plan: Plan): Effect.Effect<void> =>
    SubscriptionRef.update(snapshot, (current): Snapshot => {
      const previous = Option.flatMap(current.presentation, (presentation) =>
        presentation._tag === "Resolved" ? Option.some(presentation.entries) : Option.none<ReadonlyArray<EntryState>>()
      )
      const entries: Array<EntryState> = plan.entries.map((planned): EntryState => {
        const prior = previous.pipe(
          Option.flatMap((values) => Option.fromUndefinedOr(values.find((entry) => entry.id === planned.node.id)))
        )
        const retained = Option.flatMap(prior, (entry) =>
          Result.isSuccess(entry.input)
          && Result.isSuccess(planned.input)
          && entry.input.success.location.key === planned.input.success.location.key
            ? AsyncResult.isSuccess(entry.data)
              ? Option.some<RetainedValue>({ input: entry.input.success, data: entry.data.value })
              : entry.retained
            : Option.none<RetainedValue>()
        )
        const previousResult = retained.pipe(
          Option.map((value): AsyncResult.AsyncResult<unknown, unknown> => AsyncResult.success(value.data))
        )
        return {
          node: planned.node,
          id: planned.node.id,
          input: planned.input,
          data: AsyncResult.waitingFrom(previousResult),
          retained
        }
      })
      return {
        ...current,
        location: Option.some(location),
        status: { _tag: "Pending", attempt },
        presentation: Option.some({ _tag: "Pending", attempt, location, entries })
      }
    })

  // Ownership check and pending publication are one gated transition: a stale
  // worker whose active slot changed (even before its interruption lands) must
  // not publish a pending presentation.
  const acceptIfAuthorized = (attempt: number, location: History.Location, plan: Plan): Effect.Effect<boolean> =>
    gate(
      Effect.gen(function* () {
        if (!(yield* isAuthorized(attempt))) return false
        yield* acceptUnsafe(attempt, location, plan)
        return true
      })
    )

  const publishResolved = (
    attempt: number,
    location: History.Location,
    entries: ReadonlyArray<EntryState>
  ): Effect.Effect<void> =>
    SubscriptionRef.update(snapshot, (current): Snapshot => ({
      ...current,
      status:
        current.status._tag === "Pending" && current.status.attempt === attempt
          ? { _tag: "Committed", attempt }
          : current.status,
      presentation: Option.some({ _tag: "Resolved", attempt, location, entries }),
      resolved: Option.some({ attempt, location, entries })
    }))

  const publishFailure = (
    attempt: number,
    owner: string,
    error: unknown,
    entries: ReadonlyArray<EntryState>
  ): Effect.Effect<void> =>
    SubscriptionRef.update(snapshot, (current): Snapshot => {
      const location = Option.getOrUndefined(current.location)
      if (location === undefined) return current
      return {
        ...current,
        status:
          current.status._tag === "Pending" && current.status.attempt === attempt
            ? { _tag: "Failed", attempt, owner, error }
            : current.status,
        presentation: Option.some({
          _tag: "Failed",
          attempt,
          location,
          owner,
          error,
          entries
        })
      }
    })

  const publishCancelled = (attempt: number): Effect.Effect<void> =>
    SubscriptionRef.update(snapshot, (current): Snapshot =>
      current.status._tag === "Pending" && current.status.attempt === attempt
        ? { ...current, status: { _tag: "Cancelled", attempt } }
        : current
    )

  const prepare = (plan: Plan): Effect.Effect<PrepareOutcome> =>
    Effect.gen(function* () {
      const entries: Array<EntryState> = []
      for (const planned of plan.entries) {
        const node = planned.node
        if (Result.isFailure(planned.input)) {
          const cause = Cause.fail(planned.input.failure)
          entries.push(failedEntry(node, planned.input, cause))
          return { _tag: "Failed", owner: node.id, cause, entries }
        }
        const decoded = planned.input.success
        const implementation = implementations.get(node.id)
        if (implementation === undefined) {
          entries.push({
            node,
            id: node.id,
            input: planned.input,
            data: AsyncResult.success(undefined),
            retained: Option.some<RetainedValue>({ input: decoded, data: undefined })
          })
          continue
        }
        const exit = yield* Effect.exit(Effect.scoped(implementation.run(handlerInput(decoded))))
        if (Exit.isSuccess(exit)) {
          entries.push({
            node,
            id: node.id,
            input: planned.input,
            data: AsyncResult.success(exit.value),
            retained: Option.some<RetainedValue>({ input: decoded, data: exit.value })
          })
          continue
        }
        const redirect = findRedirect(exit.cause)
        if (redirect !== undefined) {
          if (!isMember(redirect.node)) {
            const cause = Cause.fail(foreignDestinationError(redirect.node))
            entries.push(failedEntry(node, planned.input, cause))
            return { _tag: "Failed", owner: node.id, cause, entries }
          }
          return { _tag: "Redirect", destination: redirect }
        }
        entries.push(failedEntry(node, planned.input, exit.cause))
        return { _tag: "Failed", owner: node.id, cause: exit.cause, entries }
      }
      return { _tag: "Prepared", entries }
    })

  const runAttempt = (record: ActiveAttempt): Effect.Effect<AttemptResult> =>
    Effect.gen(function* () {
      let location = record.initial
      let hops = 0
      while (true) {
        const plan = compiled.plan(location)
        // The observed location is accepted and published even when no route
        // matches, so an unknown URL surfaces a failure against its own
        // location instead of leaving an earlier presentation in place. A stale
        // worker must not accept at all: ownership is checked inside the same
        // gated transition as the pending publication.
        if (!(yield* acceptIfAuthorized(record.id, location, plan))) {
          return { _tag: "Superseded" }
        }
        if (plan.notFound) {
          return {
            _tag: "Failure",
            location,
            owner: NotFoundFailureOwner,
            cause: Cause.fail(
              new RouteNotFound({ pathname: location.pathname, search: location.search, hash: location.hash })
            ),
            entries: []
          }
        }
        const outcome = yield* prepare(plan)
        if (outcome._tag === "Prepared") return { _tag: "Success", location, entries: outcome.entries }
        if (outcome._tag === "Failed") {
          return { _tag: "Failure", location, owner: outcome.owner, cause: outcome.cause, entries: outcome.entries }
        }
        hops += 1
        if (hops > MAX_REDIRECTS) {
          return {
            _tag: "Failure",
            location,
            owner: RouterFailureOwner,
            cause: Cause.fail(new RouteDefinitionError({ message: "Redirect loop limit exceeded" })),
            entries: []
          }
        }
        const href = encode(
          outcome.destination.node as unknown as RuntimeNode,
          outcome.destination.input as {
            readonly params: unknown
            readonly search: unknown
            readonly hash: unknown
          }
        )
        if (Result.isFailure(href)) {
          return { _tag: "Failure", location, owner: RouterFailureOwner, cause: Cause.fail(href.failure), entries: [] }
        }
        // A redirect history write is also gated on ownership: a superseded
        // attempt whose interruption has not landed must not move history.
        const redirected = yield* gate(
          Effect.gen(function* () {
            if (!(yield* isAuthorized(record.id))) return { _tag: "Superseded" } as const
            const replaced = yield* Effect.exit(
              history.replace(History.destinationFromHref(href.success, outcome.destination.state))
            )
            if (Exit.isFailure(replaced)) {
              return { _tag: "Failed", cause: replaced.cause } as const
            }
            return { _tag: "Redirected", location: replaced.value } as const
          })
        )
        if (redirected._tag === "Superseded") return { _tag: "Superseded" }
        if (redirected._tag === "Failed") {
          return { _tag: "Failure", location, owner: RouterFailureOwner, cause: redirected.cause, entries: [] }
        }
        location = redirected.location
      }
    })

  const settle = (record: ActiveAttempt, exit: Exit.Exit<AttemptResult>): Effect.Effect<void> =>
    Effect.gen(function* () {
      if (Exit.isSuccess(exit)) {
        const result = exit.value
        if (result._tag === "Superseded") {
          yield* Deferred.succeed(record.outcome, "Superseded")
          return
        }
        if (result._tag === "Success") {
          yield* gate(
            Effect.gen(function* () {
              if (!(yield* isAuthorized(record.id))) {
                yield* Deferred.succeed(record.outcome, "Superseded")
                return
              }
              yield* publishResolved(record.id, result.location, result.entries)
              yield* Deferred.succeed(record.outcome, "Committed")
            })
          )
          return
        }
        if (Cause.hasInterruptsOnly(result.cause)) {
          // No snapshot write: reading status and settling the waiter does not
          // race an acceptance transition, and gating it could deadlock a
          // cancel that is awaiting this fiber's interruption.
          const status = yield* Ref.get(record.status)
          yield* Deferred.succeed(record.outcome, status === "cancelled" ? "Cancelled" : "Superseded")
          return
        }
        yield* gate(
          Effect.gen(function* () {
            if (yield* isAuthorized(record.id)) {
              yield* publishFailure(record.id, result.owner, firstFailure(result.cause), result.entries)
            }
            yield* Deferred.failCause(record.outcome, result.cause)
          })
        )
        return
      }
      if (Cause.hasInterruptsOnly(exit.cause)) {
        const status = yield* Ref.get(record.status)
        yield* Deferred.succeed(record.outcome, status === "cancelled" ? "Cancelled" : "Superseded")
        return
      }
      yield* gate(
        Effect.gen(function* () {
          if (yield* isAuthorized(record.id)) {
            const current = yield* SubscriptionRef.get(snapshot)
            yield* publishFailure(
              record.id,
              RouterFailureOwner,
              firstFailure(exit.cause),
              entriesOf(Option.getOrUndefined(current.presentation))
            )
          }
          yield* Deferred.failCause(record.outcome, exit.cause)
        })
      )
    })

  const ensureSettled = (record: ActiveAttempt, outcome: NavigationOutcome): Effect.Effect<void> =>
    Deferred.isDone(record.outcome).pipe(
      Effect.flatMap((done) => (done ? Effect.void : Deferred.succeed(record.outcome, outcome).pipe(Effect.asVoid)))
    )

  const start = (id: number, location: History.Location): Effect.Effect<ActiveAttempt> =>
    Effect.gen(function* () {
      const status = yield* Ref.make<"running" | "superseded" | "cancelled">("running")
      const ready = yield* Deferred.make<void>()
      const outcome = yield* Deferred.make<NavigationOutcome, unknown>()
      const record: ActiveAttempt = {
        id,
        status,
        ready,
        outcome,
        initial: location,
        fiber: undefined as unknown as Fiber.Fiber<void>
      }
      const body = Effect.gen(function* () {
        yield* Deferred.await(ready)
        const exit = yield* Effect.exit(runAttempt(record))
        yield* Effect.uninterruptible(settle(record, exit))
      })
      yield* gate(
        Effect.gen(function* () {
          const current = yield* Ref.get(active)
          if (Option.isSome(current) && current.value.id > id) {
            // An older command whose acceptance lost the race: it never owns
            // the active attempt and settles as superseded without forking.
            yield* Deferred.succeed(outcome, "Superseded")
            return
          }
          // Ownership, readiness, and the superseded marking/cleanup handoff are
          // one atomic uninterruptible transition. A caller interrupted during
          // acceptance can therefore never leave the older attempt unmarked or
          // its waiter/resources abandoned.
          yield* Effect.uninterruptible(
            Effect.gen(function* () {
              const fiber = yield* body.pipe(
                Effect.onInterrupt(() =>
                  Ref.get(status).pipe(
                    Effect.flatMap((value) =>
                      Deferred.succeed(outcome, value === "cancelled" ? "Cancelled" : "Superseded")
                    )
                  )
                ),
                Effect.forkIn(self)
              )
              record.fiber = fiber
              yield* Ref.set(active, Option.some(record))
              if (Option.isSome(current)) {
                yield* Ref.set(current.value.status, "superseded")
                // Cleanup is supervised in the router scope, never awaited here.
                yield* Effect.forkIn(self)(
                  Effect.gen(function* () {
                    yield* Fiber.interrupt(current.value.fiber)
                    yield* ensureSettled(current.value, "Superseded")
                  })
                )
              }
              yield* Deferred.succeed(ready, undefined)
            })
          )
        })
      )
      return record
    })

  yield* history.changes.pipe(
    Stream.runForEach((location) =>
      Effect.gen(function* () {
        const current = yield* SubscriptionRef.get(snapshot)
        if (
          Option.isSome(current.location)
          && current.location.value.key === location.key
          && current.location.value.index === location.index
        ) {
          return
        }
        yield* start(yield* allocateId, location)
      })
    ),
    Effect.catch((error) =>
      gate(
        SubscriptionRef.update(snapshot, (current): Snapshot => ({ ...current, status: { _tag: "Rejected", error } }))
      )
    ),
    Effect.forkIn(self)
  )

  // Initial navigation uses the same matching/preparation pipeline. A route
  // failure does not fail the Layer; it is published against the observed URL.
  const initialRecord = yield* history.current.pipe(
    Effect.flatMap((location) => Effect.flatMap(allocateId, (id) => start(id, location))),
    Effect.catch((error) =>
      Effect.gen(function* () {
        yield* gate(
          SubscriptionRef.update(snapshot, (current): Snapshot => ({
            ...current,
            status: { _tag: "Rejected", error }
          }))
        )
        return undefined
      })
    )
  )
  const awaitInitial: Effect.Effect<void, unknown> =
    initialRecord === undefined ? Effect.void : Deferred.await(initialRecord.outcome).pipe(Effect.asVoid)

  const cancel = (record: ActiveAttempt): Effect.Effect<void> =>
    Effect.gen(function* () {
      // Ownership check and the cancelled marking share the acceptance gate, so
      // a concurrent acceptance either supersedes first (making this stale) or
      // observes the cancelled status.
      const owns = yield* gate(
        Effect.gen(function* () {
          const current = yield* Ref.get(active)
          if (Option.isSome(current) && current.value.id === record.id) {
            yield* Ref.set(record.status, "cancelled")
            return true
          }
          return false
        })
      )
      if (!owns) return
      // Interrupting the worker is never done while holding the gate: the
      // worker's own settle may need the gate, so awaiting its interruption
      // under the gate would deadlock. Interruption, waiter settlement, and the
      // terminal status publication are all inside one uninterruptible region,
      // so a cancelling caller interrupted while a blocked finalizer runs still
      // completes the cancel sequence instead of leaving the snapshot Pending.
      yield* Effect.uninterruptible(
        Effect.gen(function* () {
          yield* Fiber.interrupt(record.fiber)
          yield* ensureSettled(record, "Cancelled")
          yield* gate(publishCancelled(record.id))
        })
      )
    })

  const reject = (error: unknown): Effect.Effect<void> =>
    gate(SubscriptionRef.update(snapshot, (current): Snapshot => ({ ...current, status: { _tag: "Rejected", error } })))

  const submit = Effect.fn("Router.submit")(function* (destination: Destination, options?: NavigateOptions) {
    const id = yield* allocateId
    if (!isMember(destination.node)) {
      const error = foreignDestinationError(destination.node)
      yield* reject(error)
      return yield* Effect.fail(error)
    }
    const href = encode(
      destination.node as unknown as RuntimeNode,
      destination.input as {
        readonly params: unknown
        readonly search: unknown
        readonly hash: unknown
      }
    )
    if (Result.isFailure(href)) {
      yield* reject(href.failure)
      return yield* Effect.fail(href.failure)
    }
    const target = History.destinationFromHref(href.success, destination.state)
    const write = options?.replace === true ? history.replace(target) : history.push(target)
    const written = yield* Effect.exit(write)
    if (Exit.isFailure(written)) {
      yield* reject(firstFailure(written.cause))
      return yield* Effect.failCause(written.cause)
    }
    const record = yield* start(id, written.value)
    return {
      id: record.id,
      await: Deferred.await(record.outcome),
      cancel: cancel(record)
    } satisfies NavigationHandle
  })

  const navigate = Effect.fn("Router.navigate")(function* (destination: Destination, options?: NavigateOptions) {
    const handle = yield* submit(destination, options)
    return yield* handle.await
  })

  const refresh: Effect.Effect<NavigationOutcome, unknown> = Effect.gen(function* () {
    const id = yield* allocateId
    const location = yield* history.current
    const record = yield* start(id, location)
    return yield* Deferred.await(record.outcome)
  })

  const go = Effect.fn("Router.go")(function* (delta: number) {
    yield* history.go(delta)
  })

  return {
    snapshot,
    awaitInitial,
    navigate,
    submit,
    refresh,
    retry: refresh,
    back: go(-1),
    forward: go(1),
    go
  }
})
