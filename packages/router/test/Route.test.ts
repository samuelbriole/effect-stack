import * as Route from "@effect-web/router/Route"
import { describe, expect, it } from "@effect/vitest"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"

describe("Route", () => {
  const project = Route.make({
    id: "project",
    path: "/projects/:projectId",
    params: {
      projectId: Schema.FiniteFromString
    },
    search: {
      tab: Schema.optionalKey(Schema.Literals(["overview", "activity"])),
      tag: Schema.optionalKey(Schema.Array(Schema.String))
    },
    hash: Schema.Literals(["", "details"])
  })

  it("builds and matches a typed route", () => {
    const href = Route.href(project, {
      params: { projectId: 42 },
      search: { tab: "activity", tag: ["effect", "web"] },
      hash: "details"
    })

    expect(Result.isSuccess(href)).toBe(true)
    if (Result.isFailure(href)) return
    expect(href.success).toBe("/projects/42?tab=activity&tag=effect&tag=web#details")

    const matched = Route.match(project, new URL(href.success, "https://example.test"))
    expect(Result.isSuccess(matched)).toBe(true)
    if (Result.isFailure(matched) || Option.isNone(matched.success)) return
    expect(matched.success.value.params).toEqual({ projectId: 42 })
    expect(matched.success.value.search).toEqual({ tab: "activity", tag: ["effect", "web"] })
    expect(matched.success.value.hash).toBe("details")
  })

  it("percent-encodes a path exactly once", () => {
    const route = Route.make({
      id: "person",
      path: "/people/:name",
      params: { name: Schema.String },
      search: {}
    })
    const href = Route.href(route, { params: { name: "Ada Lovelace/Byron" }, search: {}, hash: "" })

    expect(Result.isSuccess(href) && href.success).toBe("/people/Ada%20Lovelace%2FByron")
    if (Result.isFailure(href)) return
    const matched = Route.match(route, new URL(href.success, "https://example.test"))
    expect(Result.isSuccess(matched) && Option.isSome(matched.success) && matched.success.value.params.name).toBe(
      "Ada Lovelace/Byron"
    )
  })

  it("distinguishes a different path from invalid route data", () => {
    const different = Route.match(project, new URL("https://example.test/people/1"))
    expect(Result.isSuccess(different) && Option.isNone(different.success)).toBe(true)

    const invalid = Route.match(project, new URL("https://example.test/projects/not-a-number"))
    expect(Result.isFailure(invalid)).toBe(true)
    if (Result.isFailure(invalid)) {
      expect(invalid.failure._tag).toBe("@effect-web/router/RouteDecodeError")
      expect(invalid.failure.part).toBe("path")
    }
  })

  it("reports invalid search and hash values", () => {
    const invalidSearch = Route.match(project, new URL("https://example.test/projects/1?tab=other"))
    expect(Result.isFailure(invalidSearch) && invalidSearch.failure.part).toBe("search")

    const invalidHash = Route.match(project, new URL("https://example.test/projects/1#other"))
    expect(Result.isFailure(invalidHash) && invalidHash.failure.part).toBe("hash")
  })
})
