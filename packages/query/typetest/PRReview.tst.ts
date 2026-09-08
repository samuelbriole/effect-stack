import type * as Mutation from "@effect-stack/query/Mutation"
import type * as Query from "@effect-stack/query/Query"
import * as QueryAtom from "@effect-stack/query/QueryAtom"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import { describe, expect, test } from "tstyche"

declare const resource: Query.Resource<string, "query-error">
declare const handle: Mutation.Handle<{ readonly id: number }, boolean, "mutation-error">

describe("PR 9 observation protocol", () => {
  test("preserves exact public parameters through spread copies", () => {
    const copied = { ...resource }
    const copiedHandle = { ...handle }
    expect(copied.observation).type.toBe<Query.Observation<string, "query-error">>()
    expect(copiedHandle.observation).type.toBe<
      Mutation.Observation<{ readonly id: number }, boolean, "mutation-error">
    >()
    expect(QueryAtom.query).type.toBeCallableWith(copied)
    expect(QueryAtom.mutation).type.toBeCallableWith(copiedHandle)
  })

  test("requires the observation capability structurally", () => {
    const missing = {
      get: Effect.succeed("value"),
      refresh: Effect.succeed("value"),
      invalidate: Effect.void,
      snapshot: Effect.succeed(AsyncResult.initial<string, never>()),
      changes: Stream.make(AsyncResult.initial<string, never>())
    }
    expect(QueryAtom.query).type.not.toBeCallableWith(missing)

    const state: Mutation.State<number, string, never> = { latest: Option.none(), pendingCount: 0 }
    const fixture: Mutation.Handle<number, string, never> = {
      start: () => Effect.interrupt,
      execute: () => Effect.succeed("value"),
      snapshot: Effect.succeed(state),
      changes: Stream.make(state),
      observation: { getSnapshot: () => state, observe: () => () => {} }
    }
    expect(QueryAtom.mutation).type.toBeCallableWith(fixture)
  })
})
