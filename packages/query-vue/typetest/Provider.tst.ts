import { createQueryContext } from "@effect-stack/query-vue"
import type { AtomRegistry } from "effect/unstable/reactivity"
import { describe, expect, test } from "tstyche"
import type { Ref, VNode } from "vue"

interface App {
  readonly label: string
}

interface OtherApp {
  readonly unrelated: boolean
}

declare const registry: AtomRegistry.AtomRegistry

const { Provider, useQueryContext } = createQueryContext<App>()

describe("Vue query context types", () => {
  test("accepts exactly the App value and registry selection", () => {
    expect(Provider).type.toBeCallableWith({ value: { label: "app" } })
    expect(Provider).type.toBeCallableWith({ value: { label: "app" }, registry })
    expect(Provider).type.toBeCallableWith({ value: { label: "app" }, registry: "inherit" })
    expect(Provider).type.toBe<
      (props: {
        readonly value: App
        readonly registry?: AtomRegistry.AtomRegistry | "inherit"
      }) => VNode
    >()
  })

  test("rejects incompatible context values and registry slots", () => {
    expect(Provider).type.not.toBeCallableWith({ value: { label: 42 } })
    expect(Provider).type.not.toBeCallableWith({ value: { unrelated: true } })
    expect(Provider).type.not.toBeCallableWith({})
    expect(Provider).type.not.toBeCallableWith({ value: { label: "app" }, registry: "own" })
    expect(Provider).type.not.toBeCallableWith({ value: { label: "app" }, registry: "replace" })
  })

  test("keeps separate context factories independent", () => {
    const other = createQueryContext<OtherApp>()
    expect(other.useQueryContext).type.toBe<() => Readonly<Ref<OtherApp>>>()
    expect(other.useQueryContext().value).type.toBe<OtherApp>()
    expect(other.Provider).type.not.toBeCallableWith({ value: { label: "app" } })
    expect(Provider).type.not.toBeCallableWith({ value: { unrelated: true } })
  })

  test("reads back the exact App type through a readonly ref", () => {
    expect(useQueryContext).type.toBe<() => Readonly<Ref<App>>>()
    expect(useQueryContext()).type.toBe<Readonly<Ref<App>>>()
    expect(useQueryContext().value).type.toBe<App>()
    // @ts-expect-error Cannot assign to 'value' because it is a read-only property
    useQueryContext().value = { label: "replacement" }
  })
})
