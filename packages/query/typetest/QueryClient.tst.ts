import * as Query from "@effect-stack/query/Query"
import * as QueryClient from "@effect-stack/query/QueryClient"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import type * as Stream from "effect/Stream"
import type * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import { describe, expect, test } from "tstyche"

class Repo extends Context.Service<Repo, {
  readonly fetchName: (id: number) => Effect.Effect<string>
}>()("QueryClientTypetest/Repo") {}

class Metrics extends Context.Service<Metrics, {
  readonly count: () => Effect.Effect<void>
}>()("QueryClientTypetest/Metrics") {}

class LoadError extends Schema.TaggedError<LoadError>()("LoadError", {
  reason: Schema.String
}) {}

class InitError extends Schema.TaggedError<InitError>()("InitError", {
  reason: Schema.String
}) {}

type ValueOf<T> = T extends Effect.Effect<infer A, infer _E, infer _R> ? A : never
type ErrorOf<T> = T extends Effect.Effect<infer _A, infer E, infer _R> ? E : never
type EnvOf<T> = T extends Effect.Effect<infer _A, infer _E, infer R> ? R : never

const repoLayer: Layer.Layer<Repo> = Layer.succeed(Repo, { fetchName: () => Effect.succeed("row") })

const user = Query.make({
  name: "user",
  load: (input: { readonly id: number }) =>
    Effect.gen(function*() {
      const repo = yield* Repo
      const name = yield* repo.fetchName(input.id)
      if (name === "") return yield* Effect.fail(new LoadError({ reason: "empty" }))
      return name
    })
})

const needsMetrics = Query.make({
  name: "needsMetrics",
  load: () => Metrics.use((metrics) => metrics.count())
})

describe("QueryClient construction", () => {
  test("make is scoped and carries layer requirements and errors separately", () => {
    const built = QueryClient.make({ layer: repoLayer })
    expect<ValueOf<typeof built>>().type.toBe<QueryClient.QueryClient<Repo>>()
    expect<ErrorOf<typeof built>>().type.toBe<never>()
    expect<EnvOf<typeof built>>().type.toBe<Scope.Scope>()

    const failing = QueryClient.make({
      layer: Layer.effect(Repo, Effect.fail(new InitError({ reason: "boom" })))
    })
    expect<ErrorOf<typeof failing>>().type.toBe<InitError>()
    expect<EnvOf<typeof failing>>().type.toBe<Scope.Scope>()

    const transitive = QueryClient.make({
      layer: Layer.effect(
        Repo,
        Effect.map(Metrics, () => ({ fetchName: () => Effect.succeed("row") } as const))
      )
    })
    expect<EnvOf<typeof transitive>>().type.toBe<Metrics | Scope.Scope>()
  })

  test("makeWith takes an assembled context and stays error-free", () => {
    const built = QueryClient.makeWith(Context.make(Repo, { fetchName: () => Effect.succeed("row") }))
    expect<ValueOf<typeof built>>().type.toBe<QueryClient.QueryClient<Repo>>()
    expect<ErrorOf<typeof built>>().type.toBe<never>()
    expect<EnvOf<typeof built>>().type.toBe<Scope.Scope>()
  })
})

describe("QueryClient.query resources", () => {
  test("resource effects lose the definition services and keep loader errors", () => {
    const program = Effect.gen(function*() {
      const client = yield* QueryClient.make({ layer: repoLayer })
      const byId = client.query(user)
      const resource = byId({ id: 1 })
      expect<Effect.Services<typeof resource.get>>().type.toBe<never>()
      expect<ValueOf<typeof resource.get>>().type.toBe<string>()
      expect<ErrorOf<typeof resource.get>>().type.toBe<LoadError>()
      expect<ValueOf<typeof resource.refresh>>().type.toBe<string>()
      expect<ErrorOf<typeof resource.refresh>>().type.toBe<LoadError>()
      expect<ErrorOf<typeof resource.invalidate>>().type.toBe<never>()
      expect<ValueOf<typeof resource.invalidate>>().type.toBe<void>()
      expect<ValueOf<typeof resource.snapshot>>().type.toBe<AsyncResult.AsyncResult<string, LoadError>>()
      expect<typeof resource.changes>().type.toBe<
        Stream.Stream<AsyncResult.AsyncResult<string, LoadError>>
      >()
      return resource
    })
    expect<EnvOf<typeof program>>().type.toBe<Scope.Scope>()
    void program
  })

  test("scope-requiring loaders are accepted without widening the client environment", () => {
    const scopedLoad = Query.make({
      name: "scopedLoad",
      load: () => Effect.acquireRelease(Effect.succeed(1), () => Effect.void)
    })
    const program = Effect.gen(function*() {
      const client = yield* QueryClient.make({ layer: Layer.empty })
      const resource = client.query(scopedLoad)({})
      expect<Effect.Services<typeof resource.get>>().type.toBe<never>()
      expect<ValueOf<typeof resource.get>>().type.toBe<number>()
    })
    expect<EnvOf<typeof program>>().type.toBe<Scope.Scope>()
    void program
  })

  test("definitions with unprovided services are rejected by the client", () => {
    const program = Effect.gen(function*() {
      const emptyClient = yield* QueryClient.make({ layer: Layer.empty })
      expect(emptyClient.query).type.not.toBeCallableWith(needsMetrics)
      const repoClient = yield* QueryClient.make({ layer: repoLayer })
      expect(repoClient.query).type.toBeCallableWith(user)
      expect(repoClient.query).type.not.toBeCallableWith(needsMetrics)
    })
    void program
  })

  test("family is callable with the declared input and exposes invalidation as an effect", () => {
    const program = Effect.gen(function*() {
      const client = yield* QueryClient.make({ layer: repoLayer })
      const byId = client.query(user)
      expect(byId).type.toBeCallableWith({ id: 1 })
      expect(byId).type.not.toBeCallableWith({ id: "one" })
      expect(byId).type.not.toBeCallableWith({})
      expect(byId.invalidate).type.toBe<Effect.Effect<void>>()
    })
    void program
  })
})
