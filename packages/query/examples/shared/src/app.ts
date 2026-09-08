/**
 * Application wiring shared by every renderer example.
 *
 * `createApp` runs inside the application's own scope: it builds the mock
 * Users API Layer once, creates the `QueryClient` from that captured context
 * (`QueryClient.makeWith`), derives resources, acquires mutation handles, and
 * creates a headless Router whose loaders share the UI's query resources.
 * Successful mutations include invalidating affected reads. The adapter
 * Providers borrow `app.registry` and supply typed application context;
 * `useQuery` and `useMutation` observe the application's bound capabilities.
 * Teardown unmounts the UI before the registry is disposed and the client
 * scope closes.
 */
import * as QueryClient from "@effect-stack/query/QueryClient"
import * as MemoryHistory from "@effect-stack/router/MemoryHistory"
import * as Route from "@effect-stack/router/Route"
import * as Router from "@effect-stack/router/Router"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Atom from "effect/unstable/reactivity/Atom"
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry"
import {
  makeBumpVisitsMutation,
  makeRenameUserMutation,
  type RenameUserInput,
  userDetailQuery,
  userListQuery,
  userReportQuery
} from "./queries.ts"
import { sampleUserIds, UserId, UsersApi, usersApiLive } from "./UsersApi.ts"

export interface CreateAppOptions {
  /** Renderer batching hook, e.g. React's `scheduleTask` from `@effect/atom-react`. */
  readonly scheduleTask?: ((f: () => void) => () => void) | undefined
}

export const createApp = Effect.fn("QueryExample.createApp")(function*(options: CreateAppOptions = {}) {
  // Build the service Layer once so the client and the demo instrumentation
  // (call stats) share one instance; every app gets its own isolated cache.
  const scope = yield* Effect.scope
  const services = yield* Layer.buildWithScope(usersApiLive, scope)
  const api = Context.get(services, UsersApi)
  const client = yield* QueryClient.makeWith(services)

  // The application scope also owns the Atom registry: the adapter Providers
  // borrow it (so router and stats atoms keep native hooks on one registry),
  // it is disposed with the app scope after the UI has unmounted, never under
  // a live view.
  const registry = AtomRegistry.make({
    ...(options.scheduleTask === undefined ? {} : { scheduleTask: options.scheduleTask }),
    defaultIdleTTL: 400
  })
  yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()))

  // Families are per-definition caches; calling one binds a per-input resource.
  const userListFamily = client.query(userListQuery)
  const userDetailFamily = client.query(userDetailQuery)
  const userReportFamily = client.query(userReportQuery)
  const userList = userListFamily(undefined)

  // Client-owned cache invalidation composed into the bound mutations: every
  // committed rename or visit bump marks the affected reads stale on the
  // invocation fiber itself, even when the UI waiter goes away.
  const invalidateUserReads = Effect.gen(function*() {
    yield* userListFamily.invalidate
    yield* userDetailFamily.invalidate
  })
  // Handles are pre-acquired here, in the application scope: renderers bind
  // them through `useMutation` and never acquire controllers themselves.
  const renameUser = yield* client.mutation(makeRenameUserMutation(invalidateUserReads))
  const bumpVisits = yield* client.mutation(makeBumpVisitsMutation(invalidateUserReads))

  // Headless core Router (no renderer adapter): loaders close over query
  // resources, so route data and component data share cache entries, in-flight
  // dedupe, staleness, and invalidation.
  const usersRoute = Route.make({
    id: "users",
    path: "/",
    params: {},
    search: {},
    loader: () => userList.get
  })
  const userRoute = Route.make({
    id: "user",
    path: "/users/:userId",
    params: { userId: UserId },
    search: {},
    loader: ({ params }) => userDetailFamily(params.userId).get
  })
  const router = Router.make({
    routes: [usersRoute, userRoute] as const,
    layer: MemoryHistory.layer("/")
  })
  const navigate = (command: Router.Command<readonly [typeof usersRoute, typeof userRoute]>): void => {
    registry.set(router.navigate, command)
  }

  return {
    client,
    router,
    registry,
    /** Dispatches a navigation command through the application-owned Atom registry. */
    navigate,
    routes: { users: usersRoute, user: userRoute },
    sampleUserIds,

    /** Env-free resources the `useQuery` hooks bind; also `get`/`refresh`/`invalidate`-able directly. */
    resources: {
      userList,
      userDetail: (userId: UserId) => userDetailFamily(userId),
      userReport: (userId: UserId) => userReportFamily(userId)
    },

    /** Pre-acquired controllers the `useMutation` hooks bind, with state and invocations. */
    mutations: {
      renameUser,
      bumpVisits
    },

    /** Stable atoms for the official `@effect/atom-*` hooks. */
    atoms: {
      /** Reactive per-app mock-API call counters served by the service itself. */
      stats: Atom.subscriptionRef(api.stats)
    },

    /** High-level, environment-free scenarios the buttons trigger. */
    actions: {
      refreshUserList: () => userList.refresh,
      /** Family invalidation marks every bound entry stale; the following get refetches. */
      invalidateUserList: Effect.fn("QueryExample.invalidateUserList")(function*() {
        yield* userListFamily.invalidate
      }),
      refreshUserDetail: (userId: UserId) => userDetailFamily(userId).refresh,
      /** Two controllers at once: each shows one invocation in flight. */
      fireOverlappingMutations: Effect.fn("QueryExample.fireOverlappingMutations")(function*(input: RenameUserInput) {
        const renameInvocation = yield* renameUser.start(input)
        const bumpInvocation = yield* bumpVisits.start(input.userId)
        const renamed = yield* renameInvocation.await
        const bumped = yield* bumpInvocation.await
        return { renamed, bumped }
      }),
      /**
       * Two overlapping invocations of one controller: rename's pendingCount
       * reaches 2, and `latest` tracks the most recently started invocation
       * ("Rename B") while both commit ("Rename A" first, then "Rename B").
       */
      fireOverlappingRenames: Effect.fn("QueryExample.fireOverlappingRenames")(function*(userId: UserId) {
        const first = yield* renameUser.start({ userId, name: "Rename A" })
        const second = yield* renameUser.start({ userId, name: "Rename B" })
        const firstName = yield* first.await
        const secondName = yield* second.await
        return { first: firstName.name, second: secondName.name }
      }),
      /** Interruption is first-class: the slow rename never commits or invalidates. */
      startRenameAndInterrupt: Effect.fn("QueryExample.startRenameAndInterrupt")(function*(userId: UserId) {
        const invocation = yield* renameUser.start({ userId, name: "This name never lands" })
        yield* Effect.sleep("300 millis")
        yield* invocation.interrupt
      })
    }
  }
})

export type QueryExampleApp = Effect.Success<ReturnType<typeof createApp>>
