/**
 * Mock "remote" Users API used by the Query examples.
 *
 * The service mimics a small HTTP backend: latency on every call, JSON rows
 * validated through Schema at the boundary, typed not-found and transient
 * unavailability failures, and app-scoped reactive call counters
 * (`SubscriptionRef`) that the UI observes as an Atom, making cache behavior
 * (dedupe, staleness, retries) visible without any module-global state.
 */
import { Context, Effect, Layer, Schema, SubscriptionRef } from "effect"

export const UserId = Schema.FiniteFromString.pipe(Schema.brand("UserId"))
export type UserId = typeof UserId.Type

const userId = Schema.decodeUnknownSync(UserId)

/** Stable sample identities shared by queries, routes, and tests. */
export const sampleUserIds = {
  ada: userId("1"),
  alan: userId("2"),
  grace: userId("3")
} as const

export const User = Schema.Struct({
  id: UserId,
  name: Schema.String,
  email: Schema.String,
  visits: Schema.Int
})
export interface User extends Schema.Schema.Type<typeof User> {}

export const UserReport = Schema.Struct({
  userId: UserId,
  activity: Schema.Int,
  summary: Schema.String
})
export interface UserReport extends Schema.Schema.Type<typeof UserReport> {}

export class UserNotFound extends Schema.TaggedError<UserNotFound>()("query-example/UserNotFound", {
  userId: UserId
}) {}

/** Transient upstream failure: the query loader retries it with a Schedule. */
export class ReportUnavailable extends Schema.TaggedError<ReportUnavailable>()("query-example/ReportUnavailable", {
  userId: UserId,
  reason: Schema.String
}) {}

/**
 * Demo-only instrumentation for one mock-backend instance. Counters live in a
 * `SubscriptionRef` owned by the service Layer, so every client instance is
 * isolated and the UI observes them reactively through an Atom.
 */
export interface ApiCallStats {
  readonly userList: number
  readonly userDetail: number
  readonly reportAttempts: number
  readonly reportRetries: number
  readonly mutationExecutions: number
}

const initialStats: ApiCallStats = {
  userList: 0,
  userDetail: 0,
  reportAttempts: 0,
  reportRetries: 0,
  mutationExecutions: 0
}

export interface UsersApiInterface {
  readonly list: () => Effect.Effect<ReadonlyArray<User>>
  readonly detail: (id: UserId) => Effect.Effect<User, UserNotFound>
  readonly report: (id: UserId) => Effect.Effect<UserReport, ReportUnavailable>
  readonly rename: (id: UserId, name: string) => Effect.Effect<User, UserNotFound>
  readonly bumpVisits: (id: UserId) => Effect.Effect<User, UserNotFound>
  /** Counts each Schedule-driven retry attempt of the flaky report loader. */
  readonly recordReportRetry: () => Effect.Effect<void>
  readonly stats: SubscriptionRef.SubscriptionRef<ApiCallStats>
}

export class UsersApi extends Context.Service<UsersApi, UsersApiInterface>()("query-example/UsersApi") {}

const decodeUser = Schema.decodeUnknownEffect(User)

// The "database" holds encoded JSON rows, exactly like a remote service would.
interface UserRow {
  id: string
  name: string
  email: string
  visits: number
}

const seedRows = (): Array<UserRow> => [
  { id: "1", name: "Ada Lovelace", email: "ada@example.test", visits: 12 },
  { id: "2", name: "Alan Turing", email: "alan@example.test", visits: 7 },
  { id: "3", name: "Grace Hopper", email: "grace@example.test", visits: 21 }
]

export const usersApiLive: Layer.Layer<UsersApi> = Layer.effect(
  UsersApi,
  Effect.gen(function*() {
    const rows = seedRows()
    const stats = yield* SubscriptionRef.make<ApiCallStats>(initialStats)
    // Report attempts per user: user 2 is transiently unavailable twice,
    // user 3 is permanently unavailable, the rest succeed immediately.
    const reportAttempts = new Map<number, number>()

    const count = (field: keyof ApiCallStats) =>
      stats.pipe(SubscriptionRef.update((current) => ({ ...current, [field]: current[field] + 1 })))
    const findRow = (id: UserId): UserRow | undefined => rows.find((row) => row.id === String(id))
    // Rows are trusted seed data; a corrupt row is a server defect, not a
    // recoverable caller error.
    const decode = (row: UserRow) => decodeUser(row).pipe(Effect.orDie)

    return UsersApi.of({
      stats,
      recordReportRetry: Effect.fn("UsersApi.recordReportRetry")(function*() {
        yield* count("reportRetries")
      }),
      list: Effect.fn("UsersApi.list")(function*() {
        yield* Effect.sleep("250 millis")
        yield* count("userList")
        return yield* Effect.forEach(rows, decode)
      }),
      detail: Effect.fn("UsersApi.detail")(function*(id: UserId) {
        yield* Effect.sleep("200 millis")
        yield* count("userDetail")
        const row = findRow(id)
        if (row === undefined) {
          return yield* new UserNotFound({ userId: id })
        }
        return yield* decode(row)
      }),
      report: Effect.fn("UsersApi.report")(function*(id: UserId) {
        yield* Effect.sleep("150 millis")
        yield* count("reportAttempts")
        if (id === sampleUserIds.grace) {
          return yield* new ReportUnavailable({ userId: id, reason: "report service permanently unavailable" })
        }
        const attempts = (reportAttempts.get(id) ?? 0) + 1
        reportAttempts.set(id, attempts)
        if (id === sampleUserIds.alan && attempts <= 2) {
          return yield* new ReportUnavailable({ userId: id, reason: `transient upstream failure (${attempts}/3)` })
        }
        return { userId: id, activity: attempts * 3, summary: `Stable report after ${attempts} attempt(s)` }
      }),
      rename: Effect.fn("UsersApi.rename")(function*(id: UserId, name: string) {
        // Slow on purpose so pending mutation state is observable.
        yield* Effect.sleep("1 second")
        yield* count("mutationExecutions")
        const row = findRow(id)
        if (row === undefined) {
          return yield* new UserNotFound({ userId: id })
        }
        row.name = name
        return yield* decode(row)
      }),
      bumpVisits: Effect.fn("UsersApi.bumpVisits")(function*(id: UserId) {
        yield* Effect.sleep("300 millis")
        yield* count("mutationExecutions")
        const row = findRow(id)
        if (row === undefined) {
          return yield* new UserNotFound({ userId: id })
        }
        row.visits = row.visits + 1
        return yield* decode(row)
      })
    })
  })
)
