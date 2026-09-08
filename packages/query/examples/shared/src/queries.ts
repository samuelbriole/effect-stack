/**
 * Query definitions and Mutation factories shared by every renderer example.
 *
 * Definitions stay service-aware (`R = UsersApi`); the QueryClient provides
 * that context once, so resources and handles handed to the UI are
 * environment-free Effects. Mutations are produced by factories that receive
 * the client-owned invalidation Effect, so affected queries go stale inside
 * the invocation fiber: success is only published after invalidation, and an
 * interrupted invocation never commits.
 */
import * as Mutation from "@effect-stack/query/Mutation"
import * as Query from "@effect-stack/query/Query"
import { Effect, Schedule } from "effect"
import {
  type ReportUnavailable,
  type User,
  type UserId,
  type UserNotFound,
  type UserReport,
  UsersApi
} from "./UsersApi.ts"

export const userListQuery = Query.make({
  name: "users/list",
  load: Effect.fn("QueryExample.loadUserList")(function*(_: void) {
    return yield* UsersApi.use((api) => api.list())
  }),
  staleTime: "30 seconds",
  gcTime: "2 minutes"
})

export const userDetailQuery = Query.make({
  name: "users/detail",
  load: Effect.fn("QueryExample.loadUserDetail")(function*(userId: UserId) {
    return yield* UsersApi.use((api) => api.detail(userId))
  }),
  // Re-opening a profile within the stale window serves the cache with no
  // backend call; the example's API counters make that visible.
  staleTime: "30 seconds",
  // Short collection window: entries are evicted once no observer remains.
  gcTime: "10 seconds"
})

// Explicit native Schedule retry at the idempotent read boundary: transient
// unavailability backs off with jitter, retries are counted through the
// service for the demo UI, and exhausted failures stay visible as
// `AsyncResult.Failure`.
const reportRetrySchedule = Schedule.exponential("150 millis").pipe(
  Schedule.jittered,
  Schedule.upTo({ times: 3 }),
  Schedule.setInputType<ReportUnavailable>(),
  Schedule.tap(() => UsersApi.use((api) => api.recordReportRetry()))
)

export const userReportQuery = Query.make({
  name: "users/report",
  load: Effect.fn("QueryExample.loadUserReport")(function*(userId: UserId) {
    return yield* UsersApi.use((api) => api.report(userId)).pipe(Effect.retry(reportRetrySchedule))
  }),
  staleTime: "1 minute",
  gcTime: "10 seconds"
})

export interface RenameUserInput {
  readonly userId: UserId
  readonly name: string
}

/**
 * The rename commits a write and then invalidates the affected reads inside
 * the same invocation, so any observer of the list or detail sees fresh data
 * and interruption cannot leave a committed-but-unobserved write.
 */
export const makeRenameUserMutation = (
  invalidateReads: Effect.Effect<void>
): Mutation.Mutation<RenameUserInput, User, UserNotFound, UsersApi> =>
  Mutation.make({
    name: "users/rename",
    execute: Effect.fn("QueryExample.renameUser")(function*(input: RenameUserInput) {
      const user = yield* UsersApi.use((api) => api.rename(input.userId, input.name))
      yield* invalidateReads
      return user
    })
  })

/** The visit counter also changes list and detail rows, so it invalidates too. */
export const makeBumpVisitsMutation = (
  invalidateReads: Effect.Effect<void>
): Mutation.Mutation<UserId, User, UserNotFound, UsersApi> =>
  Mutation.make({
    name: "users/bump-visits",
    execute: Effect.fn("QueryExample.bumpVisits")(function*(userId: UserId) {
      const user = yield* UsersApi.use((api) => api.bumpVisits(userId))
      yield* invalidateReads
      return user
    })
  })

export type UserListData = ReadonlyArray<User>
export type UserReportData = UserReport
