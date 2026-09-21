import { MemoryHistory } from "@effect-stack/router"
import { describe, expect, test } from "tstyche"

describe("MemoryHistory.make", () => {
  test("accepts an omitted, string, or undefined initial href", () => {
    expect(MemoryHistory.make).type.toBeCallableWith()
    expect(MemoryHistory.make).type.toBeCallableWith("/projects/1?tab=overview#details")
    expect(MemoryHistory.make).type.toBeCallableWith(undefined)
  })

  test("rejects non-string destinations", () => {
    expect(MemoryHistory.make).type.not.toBeCallableWith(123)
    expect(MemoryHistory.make).type.not.toBeCallableWith({ pathname: "/" })
  })
})
