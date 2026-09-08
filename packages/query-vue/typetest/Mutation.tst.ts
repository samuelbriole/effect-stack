import type { Mutation } from "@effect-stack/query"
import { useMutation } from "@effect-stack/query-vue"
import type * as MutationNS from "@effect-stack/query/Mutation"
import type { Effect, Exit } from "effect"
import { Schema } from "effect"
import { describe, expect, test } from "tstyche"
import { ref } from "vue"
import type { Ref, ShallowRef } from "vue"

class Reject extends Schema.TaggedError<Reject>()("Reject", {}) {}

declare const handle: Mutation.Handle<number, string, Reject>
declare const handleRef: ShallowRef<Mutation.Handle<number, string, Reject>>

describe("Vue mutation inference", () => {
  test("binds state, effects, and promises to the exact handle parameters", () => {
    const sync = useMutation(handle)
    expect(sync.state).type.toBe<Readonly<Ref<MutationNS.State<number, string, Reject>>>>()
    expect(sync.executeEffect(1)).type.toBe<Effect.Effect<string, Reject, never>>()
    expect(sync.startEffect(1)).type.toBe<Effect.Effect<MutationNS.Invocation<string, Reject>, never, never>>()
    expect(sync.execute(1)).type.toBe<Promise<string>>()
    expect(sync.execute(1, { signal: new AbortController().signal })).type.toBe<Promise<string>>()
    expect(sync.executeExit(1)).type.toBe<Promise<Exit.Exit<string, Reject>>>()
    expect(sync.executeExit(1, { signal: new AbortController().signal })).type.toBe<
      Promise<Exit.Exit<string, Reject>>
    >()
  })

  test("follows the unwrapped resource of a ref", () => {
    const fromRef = useMutation(handleRef)
    expect(fromRef.state).type.toBe<Readonly<Ref<MutationNS.State<number, string, Reject>>>>()
    expect(fromRef.executeEffect(1)).type.toBe<Effect.Effect<string, Reject, never>>()
  })

  test("normalizes ordinary deep refs without weakening inference", () => {
    const deep = ref(handle)
    expect(deep.value.execute(1)).type.toBe<Effect.Effect<string, Reject, never>>()
    expect(useMutation(deep).executeEffect(1)).type.toBe<Effect.Effect<string, Reject, never>>()
    expect(useMutation(deep).state).type.toBe<Readonly<Ref<MutationNS.State<number, string, Reject>>>>()
  })

  test("rejects inputs outside the handle", () => {
    const sync = useMutation(handle)
    expect(sync.executeEffect).type.not.toBeCallableWith("one")
    expect(sync.startEffect).type.not.toBeCallableWith({ id: 1 })
    expect(sync.execute).type.not.toBeCallableWith(undefined)
    expect(sync.executeExit).type.not.toBeCallableWith("one")
    expect(useMutation).type.not.toBeCallableWith(() => "not-a-handle")
  })

  test("exposes mutation state only through a readonly ref", () => {
    const sync = useMutation(handle)
    // @ts-expect-error Cannot assign to 'value' because it is a read-only property
    sync.state.value = {} as MutationNS.State<number, string, Reject>
  })
})
