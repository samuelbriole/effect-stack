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

  it("round-trips singleton repeated search values and rejects empty arrays", () => {
    const route = Route.make({
      id: "tags",
      path: "/tags",
      params: {},
      search: { tag: Schema.Array(Schema.String) }
    })
    const href = Route.href(route, { params: {}, search: { tag: ["effect"] }, hash: "" })
    expect(Result.isSuccess(href) && href.success).toBe("/tags?tag=effect")
    if (Result.isFailure(href)) return

    const matched = Route.match(route, new URL(href.success, "https://example.test"))
    expect(Result.isSuccess(matched) && Option.isSome(matched.success) && matched.success.value.search.tag).toEqual([
      "effect"
    ])

    const empty = Route.href(route, { params: {}, search: { tag: [] }, hash: "" })
    expect(Result.isFailure(empty) && empty.failure.part).toBe("search")
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

    const invalidUnicode = Route.href(route, {
      params: { name: "\uD800" },
      search: {},
      hash: ""
    })
    expect(Result.isFailure(invalidUnicode) && invalidUnicode.failure.part).toBe("path")

    const dotSegment = Route.href(route, { params: { name: ".." }, search: {}, hash: "" })
    expect(Result.isFailure(dotSegment) && dotSegment.failure.part).toBe("path")
  })

  it("encodes static path segments exactly once", () => {
    const route = Route.make({ id: "encoded-static", path: "/café/100%", params: {}, search: {} })
    const href = Route.href(route, { params: {}, search: {}, hash: "" })
    expect(Result.isSuccess(href) && href.success).toBe("/caf%C3%A9/100%25")
    if (Result.isFailure(href)) return

    const matched = Route.match(route, new URL(href.success, "https://example.test"))
    expect(Result.isSuccess(matched) && Option.isSome(matched.success)).toBe(true)
  })

  it("keeps trailing and repeated slashes significant", () => {
    const route = Route.make({ id: "exact", path: "/exact/path", params: {}, search: {} })

    const trailing = Route.match(route, new URL("https://example.test/exact/path/"))
    const repeated = Route.match(route, new URL("https://example.test/exact//path"))
    expect(Result.isSuccess(trailing) && Option.isNone(trailing.success)).toBe(true)
    expect(Result.isSuccess(repeated) && Option.isNone(repeated.success)).toBe(true)
  })

  it("rejects invalid definitions at runtime for untyped callers", () => {
    const makeUntyped = Route.make as (options: {
      readonly id: string
      readonly path: string
      readonly params: Record<string, typeof Schema.String>
      readonly search: Record<string, typeof Schema.String>
    }) => Route.Any

    expect(() =>
      makeUntyped({
        id: "invalid",
        path: "/projects/:projectId",
        params: {},
        search: {}
      })
    ).toThrowError(Route.RouteDefinitionError)
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

    const searchEncodeFailure = Route.href(project, {
      params: { projectId: 1 },
      search: { tab: "other" as "activity" },
      hash: ""
    })
    expect(Result.isFailure(searchEncodeFailure) && searchEncodeFailure.failure.part).toBe("search")

    const hashEncodeFailure = Route.href(project, {
      params: { projectId: 1 },
      search: {},
      hash: "other" as "details"
    })
    expect(Result.isFailure(hashEncodeFailure) && hashEncodeFailure.failure.part).toBe("hash")
  })
})
