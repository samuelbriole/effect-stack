import * as Mutation from "@effect-stack/query/Mutation"
import * as QueryClient from "@effect-stack/query/QueryClient"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import type * as Stream from "effect/Stream"
import { describe, expect, test } from "tstyche"

class Repo extends Context.Service<Repo, {
  readonly save: (item: string) => Effect.Effect<string, SubmitError>
}>()("MutationTypetest/Repo") {}

class SubmitError extends Schema.TaggedError<SubmitError>()("SubmitError", {
  reason: Schema.String
}) {}

type ValueOf<T> = T extends Effect.Effect<infer A, infer _E, infer _R> ? A : never
type ErrorOf<T> = T extends Effect.Effect<infer _A, infer E, infer _R> ? E : never
type EnvOf<T> = T extends Effect.Effect<infer _A, infer _E, infer R> ? R : never

interface AddItemInput {
  readonly item: string
}

const addItem = Mutation.make({
  name: "addItem",
  execute: (input: AddItemInput) => Repo.use((repo) => repo.save(input.item))
})

const plainMutation = Mutation.make({
  name: "plainMutation",
  execute: (input: AddItemInput) => Effect.succeed(input.item.length)
})

const clientWithRepo = Effect.gen(function*() {
  return yield* QueryClient.make({
    layer: Layer.succeed(Repo, { save: (item) => Effect.succeed(item) })
  })
})

describe("Mutation.make", () => {
  test("definition type parameters flow from the annotated execute effect", () => {
    expect(addItem).type.toBeAssignableTo<Mutation.Mutation<AddItemInput, string, SubmitError, Repo>>()
    expect(plainMutation).type.toBeAssignableTo<Mutation.Mutation<AddItemInput, number, never, never>>()
  })
})

describe("Mutation handles", () => {
  test("handles bind input, success, and error while losing the construction services", () => {
    const program = Effect.gen(function*() {
      const client = yield* clientWithRepo
      const handle = yield* client.mutation(addItem)
      expect(handle.execute).type.toBeCallableWith({ item: "a" })
      expect(handle.execute).type.not.toBeCallableWith({ item: 42 })
      expect<ErrorOf<ReturnType<typeof handle.execute>>>().type.toBe<SubmitError>()
      expect<ValueOf<ReturnType<typeof handle.execute>>>().type.toBe<string>()
      expect<EnvOf<ReturnType<typeof handle.execute>>>().type.toBe<never>()

      const invocation = yield* handle.start({ item: "a" })
      expect<ValueOf<typeof invocation.await>>().type.toBe<string>()
      expect<ErrorOf<typeof invocation.await>>().type.toBe<SubmitError>()
      expect<EnvOf<typeof invocation.await>>().type.toBe<never>()
      expect<ValueOf<typeof invocation.interrupt>>().type.toBe<void>()
      expect<Mutation.Invocation<string, SubmitError>["id"]>().type.not.toBe<number>()
      return invocation
    })
    expect<EnvOf<typeof program>>().type.toBe<Scope.Scope>()
    void program
  })

  test("state and changes are typed by input, success, and error", () => {
    const program = Effect.gen(function*() {
      const client = yield* clientWithRepo
      const handle = yield* client.mutation(addItem)
      expect<ValueOf<typeof handle.snapshot>>().type.toBe<Mutation.State<AddItemInput, string, SubmitError>>()
      expect<typeof handle.changes>().type.toBe<Stream.Stream<Mutation.State<AddItemInput, string, SubmitError>>>()
      expect<Mutation.State<AddItemInput, string, SubmitError>["pendingCount"]>().type.toBe<number>()
    })
    void program
  })

  test("mutations with unprovided services are rejected by the client", () => {
    const program = Effect.gen(function*() {
      const emptyClient = yield* QueryClient.make({ layer: Layer.empty })
      expect(emptyClient.mutation).type.not.toBeCallableWith(addItem)
      const client = yield* clientWithRepo
      expect(client.mutation).type.toBeCallableWith(addItem)
    })
    void program
  })
})
