import * as Query from "@effect-stack/query/Query"
import * as QueryClient from "@effect-stack/query/QueryClient"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import { describe, expect, test } from "tstyche"

class Users extends Context.Service<Users, { readonly get: Effect.Effect<string> }>()("ClientVariance/Users") {}
class Auth extends Context.Service<Auth, { readonly token: string }>()("ClientVariance/Auth") {}
class Metrics extends Context.Service<Metrics, { readonly count: Effect.Effect<void> }>()("ClientVariance/Metrics") {}
class InitError extends Schema.TaggedError<InitError>()("InitError", {}) {}

declare const emptyClient: QueryClient.QueryClient<never>
declare const usersClient: QueryClient.QueryClient<Users>
declare const authClient: QueryClient.QueryClient<Auth>
declare const fullClient: QueryClient.QueryClient<Users | Auth>

type ErrorOf<T> = T extends Effect.Effect<infer _A, infer E, infer _R> ? E : never
type EnvOf<T> = T extends Effect.Effect<infer _A, infer _E, infer R> ? R : never

const usersQuery = Query.make({
  name: "users",
  load: () => Users.use((users) => users.get)
})

const metricsQuery = Query.make({
  name: "metrics",
  load: () => Metrics.use((metrics) => metrics.count)
})

describe("QueryClient service capacity", () => {
  test("is contravariant in the services provided by the client", () => {
    expect(fullClient).type.toBeAssignableTo<QueryClient.QueryClient<Users>>()
    expect(fullClient).type.toBeAssignableTo<QueryClient.QueryClient<Auth>>()
    expect(emptyClient).type.not.toBeAssignableTo<QueryClient.QueryClient<Users>>()
    expect(authClient).type.not.toBeAssignableTo<QueryClient.QueryClient<Users>>()
    expect(usersClient).type.not.toBeAssignableTo<QueryClient.QueryClient<Auth>>()
  })

  test("does not let an incomplete structural wrapper forge service capacity", () => {
    const incomplete = { query: usersClient.query, mutation: usersClient.mutation }
    expect(incomplete).type.not.toBeAssignableTo<QueryClient.QueryClient<Users>>()
  })

  test("checks definitions while keeping bound operations environment-free", () => {
    expect(fullClient.query).type.toBeCallableWith(usersQuery)
    expect(usersClient.query).type.not.toBeCallableWith(metricsQuery)
    expect(emptyClient.query).type.not.toBeCallableWith(usersQuery)

    const scopeOnly = Query.make({
      name: "scope-only",
      load: () => Effect.acquireRelease(Effect.succeed(1), () => Effect.void)
    })
    const resource = emptyClient.query(scopeOnly)(undefined)
    expect<EnvOf<typeof resource.get>>().type.toBe<never>()
  })

  test("keeps layer initialization errors at construction", () => {
    const client = QueryClient.make({
      layer: Layer.effect(Users, Effect.fail(new InitError()))
    })
    expect<ErrorOf<typeof client>>().type.toBe<InitError>()
    expect<EnvOf<typeof client>>().type.toBe<Scope.Scope>()
  })
})
