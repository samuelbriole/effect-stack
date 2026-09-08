import type { Mutation, Query } from "@effect-stack/query"
import { createQueryContext, useMutation, useQuery } from "@effect-stack/query-react"
import type * as Effect from "effect/Effect"
import type * as Exit from "effect/Exit"
import type * as Option from "effect/Option"
import type * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import type * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry"
import { describe, expect, test } from "tstyche"

interface App {
  readonly name: string
}

class QueryError {
  readonly _tag = "QueryError"
}

interface Input {
  readonly id: number
}

declare const resource: Query.Resource<string, QueryError>
declare const optionalResource: Option.Option<Query.Resource<string, QueryError>>
declare const handle: Mutation.Handle<Input, number, QueryError>
declare const registry: AtomRegistry.AtomRegistry

type EnvOf<T> = T extends Effect.Effect<infer _A, infer _E, infer R> ? R : never

describe("React Query inference", () => {
  test("preserves query success and expected error types", () => {
    expect(useQuery(resource)).type.toBe<AsyncResult.AsyncResult<string, QueryError>>()
    expect(useQuery(optionalResource)).type.toBe<AsyncResult.AsyncResult<string, QueryError>>()
  })

  test("preserves mutation input, success, error, and environment-free effects", () => {
    const mutation = useMutation(handle)
    expect(mutation.state).type.toBe<Mutation.State<Input, number, QueryError>>()
    expect(mutation.executeEffect).type.toBe<(input: Input) => Effect.Effect<number, QueryError>>()
    expect(mutation.startEffect).type.toBe<(input: Input) => Effect.Effect<Mutation.Invocation<number, QueryError>>>()
    expect<EnvOf<ReturnType<typeof mutation.executeEffect>>>().type.toBe<never>()
    expect(mutation.execute({ id: 1 })).type.toBe<Promise<number>>()
    expect(mutation.executeExit({ id: 1 })).type.toBe<Promise<Exit.Exit<number, QueryError>>>()
    expect(mutation.execute).type.not.toBeCallableWith({ id: "wrong" })
  })

  test("keeps each factory's concrete application type", () => {
    const context = createQueryContext<App>()
    expect(context.useQueryContext()).type.toBe<App>()
    expect(context.Provider).type.toBeCallableWith({ value: { name: "app" }, registry, children: null })
    expect(context.Provider).type.toBeCallableWith({ value: { name: "app" }, registry: "inherit" })
    expect(context.Provider).type.not.toBeCallableWith({ value: { name: 1 } })
    expect(context.Provider).type.not.toBeCallableWith({ value: { name: "app" }, registry: "borrow" })
  })
})
