import * as Mutation from "@effect-stack/query/Mutation"
import * as Query from "@effect-stack/query/Query"
import * as QueryAtom from "@effect-stack/query/QueryAtom"
import * as QueryClient from "@effect-stack/query/QueryClient"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import type * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import type * as Atom from "effect/unstable/reactivity/Atom"
import { describe, expect, test } from "tstyche"

class LoadError extends Schema.TaggedError<LoadError>()("LoadError", {
  reason: Schema.String
}) {}

class SubmitError extends Schema.TaggedError<SubmitError>()("SubmitError", {
  reason: Schema.String
}) {}

interface AddItemInput {
  readonly item: string
}

const user = Query.make({
  name: "user",
  load: (input: { readonly id: number }) =>
    Effect.succeed(`user-${input.id}`).pipe(Effect.mapError(() => new LoadError({ reason: "down" })))
})

const addItem = Mutation.make({
  name: "addItem",
  execute: (input: AddItemInput) =>
    Effect.succeed(input.item.length).pipe(Effect.mapError(() => new SubmitError({ reason: "down" })))
})

const program = Effect.gen(function*() {
  const client = yield* QueryClient.make({ layer: Layer.empty })
  const resource = client.query(user)({ id: 1 })
  const handle = yield* client.mutation(addItem)

  const queryAtom = QueryAtom.query(resource)
  expect(queryAtom).type.toBe<Atom.Atom<AsyncResult.AsyncResult<string, LoadError>>>()
  expect(QueryAtom.query).type.toBeCallableWith(resource)
  expect(QueryAtom.query).type.not.toBeCallableWith(handle)
  expect(QueryAtom.query).type.not.toBeCallableWith("not-a-resource")
  expect(queryAtom).type.not.toBeAssignableTo<Atom.Writable<unknown, unknown>>()

  const mutationAtom = QueryAtom.mutation(handle)
  expect(mutationAtom).type.toBe<Atom.Atom<Mutation.State<AddItemInput, number, SubmitError>>>()
  expect(QueryAtom.mutation).type.toBeCallableWith(handle)
  expect(QueryAtom.mutation).type.not.toBeCallableWith(resource)
  expect(mutationAtom).type.not.toBeAssignableTo<Atom.Writable<unknown, unknown>>()
})

void program

describe("QueryAtom", () => {
  test("atoms are typed from the bound resource and handle", () => {
    expect(user).type.toBeAssignableTo<Query.Query<{ readonly id: number }, string, LoadError, never>>()
    expect(addItem).type.toBeAssignableTo<Mutation.Mutation<AddItemInput, number, SubmitError, never>>()
  })
})
