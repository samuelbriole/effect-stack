import type { Query } from "@effect-stack/query"
import { createQueryContext, useQuery } from "@effect-stack/query-vue"
import { Option, Schema } from "effect"
import type * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import { describe, expect, test } from "tstyche"
import { ref } from "vue"
import type { Ref, ShallowRef } from "vue"

class ApiError extends Schema.TaggedError<ApiError>()("ApiError", {}) {}

interface App {
  readonly name: string
  readonly visit: (id: number) => Query.Resource<string, ApiError>
}

declare const resource: Query.Resource<{ readonly items: ReadonlyArray<string> }, ApiError>
declare const resourceRef: ShallowRef<
  | Query.Resource<{ readonly items: ReadonlyArray<string> }, ApiError>
  | Option.Option<
    Query.Resource<{ readonly items: ReadonlyArray<string> }, ApiError>
  >
>

type Items = { readonly items: ReadonlyArray<string> }
type Expected = Readonly<Ref<AsyncResult.AsyncResult<Items, ApiError>>>

describe("Vue query inference", () => {
  test("reads exact success and failure types from every accepted form", () => {
    expect(useQuery(resource)).type.toBe<Expected>()
    expect(useQuery(() => resource)).type.toBe<Expected>()
    expect(useQuery(resourceRef)).type.toBe<Expected>()
    expect(useQuery(Option.some(resource))).type.toBe<Expected>()
    expect(useQuery(() => Option.some(resource))).type.toBe<Expected>()
    expect(useQuery<Items, never>(Option.none())).type.toBe<Readonly<Ref<AsyncResult.AsyncResult<Items, never>>>>()
  })

  test("normalizes ordinary deep refs without weakening inference", () => {
    const deep = ref(resource)
    expect(useQuery(deep)).type.toBe<Expected>()
    const deepOption = ref<Option.Option<typeof resource>>(Option.some(resource))
    expect(useQuery(deepOption)).type.toBe<Expected>()
  })

  test("propagates dependent resource types", () => {
    const { useQueryContext } = createQueryContext<App>()
    expect(useQueryContext().value.visit(1)).type.toBe<Query.Resource<string, ApiError>>()
    expect(useQueryContext()).type.toBe<Readonly<Ref<App>>>()
  })

  test("rejects unrelated resource values", () => {
    expect(useQuery).type.not.toBeCallableWith(42)
    expect(useQuery).type.not.toBeCallableWith(() => "not-a-resource")
    // A structurally similar object is not a branded core resource.
    expect(useQuery).type.not.toBeCallableWith({
      get: null,
      refresh: null,
      invalidate: null,
      snapshot: null,
      changes: null
    })
  })

  test("exposes results only through readonly refs", () => {
    const result = useQuery(resource)
    expect(result.value).type.toBe<AsyncResult.AsyncResult<Items, ApiError>>()
    // @ts-expect-error Cannot assign to 'value' because it is a read-only property
    result.value = {} as AsyncResult.AsyncResult<Items, ApiError>
  })
})
