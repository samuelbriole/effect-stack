import { Mutation, Query, type QueryClient } from "@effect-stack/query"
import {
  createQueryContext,
  type MutationResult,
  type QueryProviderProps,
  useMutation,
  useQuery
} from "@effect-stack/query-solid"
import { Context, Option, Schema } from "effect"
import type * as Effect from "effect/Effect"
import type * as Exit from "effect/Exit"
import type * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import type * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry"
import type { Accessor } from "solid-js"
import type { Store } from "solid-js/store"
import { describe, expect, test } from "tstyche"

interface User {
  readonly name: string
}

class LoadError extends Schema.TaggedError<LoadError>()("LoadError", {
  reason: Schema.String
}) {}

interface TestApp {
  readonly users: Query.Resource<User, LoadError>
  readonly rename: Mutation.Handle<string, User, LoadError>
}

interface AlienApp {
  readonly alien: string
}

declare const resource: Query.Resource<User, LoadError>
declare const optionalResource: Accessor<Option.Option<Query.Resource<User, LoadError>>>
declare const handle: Accessor<Mutation.Handle<string, User, LoadError>>
declare const rawHandle: Mutation.Handle<string, User, LoadError>
declare const registry: AtomRegistry.AtomRegistry
declare const app: TestApp
declare const alien: AlienApp
declare const signal: AbortSignal
// Solid's Store type keeps the plain member type even though reads are proxied.
declare const storeResourceSelection: Store<{ readonly users: Query.Resource<User, LoadError> }>
declare const storeHandleSelection: Store<{ readonly rename: Mutation.Handle<string, User, LoadError> }>

const TestCtx = createQueryContext<TestApp>()
const Alien = createQueryContext<AlienApp>()

class Api extends Context.Service<Api, {
  readonly fetchUser: (id: number) => Effect.Effect<User, LoadError>
  readonly renameUser: (id: string) => Effect.Effect<User, LoadError>
}>()("typetest/Api") {}

const usersDefinition = Query.make({
  name: "wired/users",
  load: (id: number) => Api.use((api) => api.fetchUser(id))
})
const renameDefinition = Mutation.make({
  name: "wired/rename",
  execute: (id: string) => Api.use((api) => api.renameUser(id))
})
declare const client: QueryClient.QueryClient<Api>
declare const incomplete: QueryClient.QueryClient<never>

interface WiredApp {
  readonly users: Query.Family<number, User, LoadError>
  readonly rename: Mutation.Handle<string, User, LoadError>
}
const Wired = createQueryContext<WiredApp>()
declare const wired: WiredApp

describe("query-solid inference", () => {
  test("useQuery requires accessors and preserves exact result types", () => {
    expect(useQuery(() => resource)).type.toBe<Accessor<AsyncResult.AsyncResult<User, LoadError>>>()
    expect(useQuery(optionalResource)).type.toBe<Accessor<AsyncResult.AsyncResult<User, LoadError>>>()
    expect(useQuery(() => Option.some(resource))).type.toBe<Accessor<AsyncResult.AsyncResult<User, LoadError>>>()
    // Store selections are plain object values: Solid's Store type keeps the
    // exact member type, so inference survives the proxy.
    expect(useQuery(() => storeResourceSelection.users)).type.toBe<Accessor<AsyncResult.AsyncResult<User, LoadError>>>()
    // Plain (non-reactive) inputs and wrong payloads are rejected.
    expect(useQuery).type.not.toBeCallableWith(resource)
    expect(useQuery).type.not.toBeCallableWith(() => 42)
    expect(useQuery).type.not.toBeCallableWith(() => "not-a-resource")
    expect(useQuery).type.not.toBeCallableWith(handle)
  })

  test("the application context keeps its concrete type and honest accessor shape", () => {
    expect(TestCtx.useQueryContext).type.toBe<() => Accessor<TestApp>>()
    expect(Alien.useQueryContext).type.toBe<() => Accessor<AlienApp>>()
    expect(TestCtx.Provider).type.toBeCallableWith({ value: app })
    expect(TestCtx.Provider).type.toBeCallableWith({ value: app, registry })
    expect(TestCtx.Provider).type.toBeCallableWith({ value: app, registry: "inherit" })
    // Incompatible application values and unknown registry modes are rejected.
    expect(TestCtx.Provider).type.not.toBeCallableWith({ value: alien })
    expect(TestCtx.Provider).type.not.toBeCallableWith({ value: app, registry: "provide" })
    expect(Alien.Provider).type.not.toBeCallableWith({ value: app })
    expect<QueryProviderProps<TestApp>>().type.not.toBe<QueryProviderProps<AlienApp>>()
  })

  test("mutation actions are input-typed and environment-free", () => {
    const mutation = useMutation(handle)
    expect(mutation).type.toBe<MutationResult<string, User, LoadError>>()
    expect(useMutation(() => storeHandleSelection.rename)).type.toBe<MutationResult<string, User, LoadError>>()
    expect(mutation.state).type.toBe<Accessor<Mutation.State<string, User, LoadError>>>()
    expect(mutation.executeEffect("ada")).type.toBe<Effect.Effect<User, LoadError>>()
    expect(mutation.startEffect("ada")).type.toBe<Effect.Effect<Mutation.Invocation<User, LoadError>>>()
    expect(mutation.execute("ada")).type.toBe<Promise<User>>()
    expect(mutation.execute("ada", { signal })).type.toBe<Promise<User>>()
    expect(mutation.executeExit("ada")).type.toBe<Promise<Exit.Exit<User, LoadError>>>()
    expect(mutation.execute).type.not.toBeCallableWith(42)
    expect(mutation.executeEffect).type.not.toBeCallableWith(42)
    // The hook needs a reactive handle, not the raw controller.
    expect(useMutation).type.not.toBeCallableWith(rawHandle)
    expect(useMutation).type.not.toBeCallableWith(() => resource)
  })

  test("wires service-dependent definitions through a sufficient client and application context", () => {
    expect(usersDefinition).type.toBe<Query.Query<number, User, LoadError, Api>>()
    expect(renameDefinition).type.toBe<Mutation.Mutation<string, User, LoadError, Api>>()

    // A client supplying the services erases them into environment-free bindings.
    expect(client.query(usersDefinition)).type.toBe<Query.Family<number, User, LoadError>>()
    expect(client.query(usersDefinition)(1)).type.toBe<Query.Resource<User, LoadError>>()
    expect(client.mutation(renameDefinition)).type.toBe<Effect.Effect<Mutation.Handle<string, User, LoadError>>>()

    // An insufficient client fails to bind the service requirements.
    expect(incomplete.query).type.not.toBeCallableWith(usersDefinition)
    expect(incomplete.mutation).type.not.toBeCallableWith(renameDefinition)

    // The full chain: application context accessor through the hooks with exact
    // data, error, and environment-free results.
    expect(Wired.useQueryContext).type.toBe<() => Accessor<WiredApp>>()
    expect(Wired.Provider).type.toBeCallableWith({ value: wired })
    // Incompatible application values stay rejected even with the wired shapes.
    expect(Wired.Provider).type.not.toBeCallableWith({ value: app })
    expect(TestCtx.Provider).type.not.toBeCallableWith({ value: wired })

    function chain(context: Accessor<WiredApp>) {
      expect(useQuery(() => context().users(1))).type.toBe<Accessor<AsyncResult.AsyncResult<User, LoadError>>>()
      expect(useQuery(() => Option.some(context().users(7)))).type.toBe<
        Accessor<AsyncResult.AsyncResult<User, LoadError>>
      >()
      const wiredMutation = useMutation(() => context().rename)
      expect(wiredMutation).type.toBe<MutationResult<string, User, LoadError>>()
      expect(wiredMutation.executeEffect("x")).type.toBe<Effect.Effect<User, LoadError>>()
      expect(wiredMutation.execute("x")).type.toBe<Promise<User>>()
      expect(wiredMutation.executeExit("x")).type.toBe<Promise<Exit.Exit<User, LoadError>>>()
    }
    // The chain body only needs to compile; it is never invoked in a type test.
    void chain
  })
})
