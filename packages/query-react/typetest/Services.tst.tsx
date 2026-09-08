import { Mutation, Query, QueryClient } from "@effect-stack/query"
import { createQueryContext, useMutation, useQuery } from "@effect-stack/query-react"
import { Context, Effect, Layer, Schema } from "effect"
import type * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import { describe, expect, test } from "tstyche"

interface User {
  readonly id: string
  readonly name: string
}

class UserError extends Schema.TaggedError<UserError>()("UserError", {}) {}

class Users extends Context.Service<Users, {
  readonly get: (id: string) => Effect.Effect<User, UserError>
  readonly rename: (user: User) => Effect.Effect<User, UserError>
}>()("test/Users") {}

const userQuery = Query.make({
  name: "users.detail",
  load: Effect.fn("users.detail")(function*(id: string) {
    const api = yield* Users
    return yield* api.get(id)
  })
})

const renameDefinition = Mutation.make({
  name: "users.rename",
  execute: Effect.fn("users.rename")(function*(user: User) {
    const api = yield* Users
    return yield* api.rename(user)
  })
})

const makeApp = Effect.gen(function*() {
  const client = yield* QueryClient.make({
    layer: Layer.succeed(
      Users,
      Users.of({
        get: (id) => Effect.succeed({ id, name: "Ada" }),
        rename: Effect.succeed
      })
    )
  })
  return {
    client,
    users: client.query(userQuery),
    rename: yield* client.mutation(renameDefinition)
  }
})

type App = Effect.Success<typeof makeApp>
const AppQuery = createQueryContext<App>()
declare const emptyClient: QueryClient.QueryClient<never>

describe("service-backed React Query inference", () => {
  test("retains bound capabilities through typed application context", () => {
    const app = AppQuery.useQueryContext()
    expect(app.client).type.toBe<QueryClient.QueryClient<Users>>()
    expect(useQuery(app.users("ada"))).type.toBe<AsyncResult.AsyncResult<User, UserError>>()
    const rename = useMutation(app.rename)
    expect(rename.executeEffect({ id: "ada", name: "Grace" })).type.toBe<Effect.Effect<User, UserError>>()
    expect(rename.startEffect({ id: "ada", name: "Grace" })).type.toBe<
      Effect.Effect<Mutation.Invocation<User, UserError>>
    >()
    expect(app.users).type.not.toBeCallableWith(1)
    expect(AppQuery.Provider).type.not.toBeCallableWith({ value: { ...app, client: emptyClient } })
  })

  test("checks services before binding resources or controllers", () => {
    expect(emptyClient.query).type.not.toBeCallableWith(userQuery)
    expect(emptyClient.mutation).type.not.toBeCallableWith(renameDefinition)
  })
})
