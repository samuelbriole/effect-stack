import { describe, expect, it } from "@effect/vitest"
import { MemoryHistory, Router } from "@effect-stack/router"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import { decodeFailure, decodeInput, encodeInput, toState } from "../src/internal/snapshot.js"
import { State } from "@effect-stack/router-foldkit"

const Id = Schema.FiniteFromString.pipe(Schema.brand("SnapshotId"))
const Item = Router.route("item", "/items/:id", {
  params: { id: Id },
  search: { page: Schema.FiniteFromString },
  hash: Schema.optional(Schema.String)
})
const App = Router.make("Snapshot", [Item])
const layer = App.layer.pipe(Layer.provide(MemoryHistory.layer("/items/12?page=3")))
const location = { pathname: "/items/12", search: "?page=3", hash: "" }
const input = { params: { id: Id.make(12) }, search: { page: 3 }, hash: undefined, location }
const node = Item.to(input).node
const DomainError = Schema.Struct({ code: Schema.String, count: Schema.FiniteFromString })
const Failed = Router.route("failed", "/failed", {
  prepare: () => Effect.fail({ code: "denied", count: 2 })
})
const FailedApp = Router.make("FailedSnapshot", [Failed])
const failedLayer = FailedApp.layer.pipe(Layer.provide(MemoryHistory.layer("/failed")))

describe("Foldkit serializable snapshots", () => {
  it("roundtrips original branded/transformed URL codecs and preserves undefined hashes and locations", () => {
    const encoded = encodeInput(node, input)
    expect(encoded).toEqual({ params: '{"id":"12"}', search: '{"page":"3"}', hash: null, location })
    expect(decodeInput(node, encoded)).toEqual(input)
    const withHash = { ...input, hash: "section", location: { ...location, hash: "#section" } }
    expect(decodeInput(node, encodeInput(node, withHash))).toEqual(withHash)
    expect(() =>
      decodeInput(node, {
        params: '{"id":"invalid"}',
        search: encoded.search,
        hash: encoded.hash,
        location: encoded.location
      })
    ).toThrow()
  })

  it.effect("retains displayed input during pending work and excludes runtime values and history state", () =>
    Effect.gen(function* () {
      const router = yield* App.service
      yield* router.awaitInitial
      const state = yield* router.state
      const oldLocation = Option.getOrThrow(state.location)
      const nextLocation = { ...oldLocation, pathname: "/items/99", state: { callback: () => undefined } }
      const pending: Router.RouterState<unknown> = {
        ...state,
        location: Option.some(nextLocation),
        status: { _tag: "Pending", attempt: 2 },
        presentation: Option.some({ _tag: "Pending", attempt: 2, location: nextLocation })
      }
      const snapshot = toState("Snapshot", pending, new Map())
      expect(snapshot).toMatchObject({ status: "Pending", attempt: 2, display: "Entries" })
      expect(snapshot.location?.pathname).toBe("/items/99")
      expect(snapshot.entries[0]?.input?.location.pathname).toBe("/items/12")
      const json = yield* Schema.encodeEffect(Schema.fromJsonString(State))(snapshot)
      expect(json).not.toContain("callback")
      expect(json).not.toContain("paramsSchema")
      expect(json).not.toContain("RouteDescriptor")
      expect(snapshot.location).not.toHaveProperty("state")
      expect(yield* Schema.decodeEffect(Schema.fromJsonString(State))(json)).toEqual(snapshot)
    }).pipe(Effect.provide(layer))
  )

  it.effect("projects non-JSON URL encoding as a router failure without changing accepted navigation facts", () =>
    Effect.gen(function* () {
      const router = yield* App.service
      yield* router.awaitInitial
      const state = yield* router.state
      const resolved = Option.getOrThrow(state.resolved)
      const brokenEntries = resolved.entries.map((entry) => ({
        ...entry,
        node: { ...entry.node, hashSchema: Schema.Unknown },
        input: Result.succeed({ ...input, location: Option.getOrThrow(state.location), hash: () => undefined })
      }))
      const corrupted: Router.RouterState<unknown> = {
        ...state,
        presentation: Option.some({
          _tag: "Pending",
          attempt: 2,
          location: Option.getOrThrow(state.location)
        }),
        resolved: Option.some({ ...resolved, entries: brokenEntries })
      }
      const snapshot = toState("Snapshot", corrupted, new Map())
      expect(snapshot).toMatchObject({ display: "RouterFailure", entries: [], status: state.status._tag })
      expect(snapshot.diagnostic?.operation).toBe("Router.snapshot")
      expect(() => Schema.encodeSync(Schema.fromJsonString(State))(snapshot)).not.toThrow()
    }).pipe(Effect.provide(layer))
  )

  it.effect("roundtrips typed domain errors only through a working registered codec", () =>
    Effect.gen(function* () {
      const router = yield* FailedApp.service
      yield* Effect.exit(router.awaitInitial)
      const state = yield* router.state
      const snapshot = toState("FailedSnapshot", state, new Map([[Failed.id, { errorSchema: DomainError }]]))
      const failure = snapshot.entries[0]?.failure
      if (failure === undefined || failure === null) throw new Error("Expected entry failure")
      expect(failure).toEqual({ _tag: "Domain", error: '{"code":"denied","count":"2"}' })
      expect(decodeFailure(failure, DomainError)).toEqual({ _tag: "Domain", error: { code: "denied", count: 2 } })
      expect(decodeFailure(failure)).toMatchObject({ _tag: "Diagnostic", diagnostic: { reasons: ["Failure"] } })
      expect(decodeFailure({ _tag: "Domain", error: "not JSON" }, DomainError)._tag).toBe("Diagnostic")
      expect(decodeFailure(failure, Schema.Number)._tag).toBe("Diagnostic")
      expect(toState("FailedSnapshot", state, new Map()).entries[0]?.failure).toMatchObject({
        _tag: "Diagnostic",
        diagnostic: { reasons: ["Failure"] }
      })
      expect(
        toState("FailedSnapshot", state, new Map([[Failed.id, { errorSchema: Schema.Number }]])).entries[0]?.failure
          ?._tag
      ).toBe("Diagnostic")
    }).pipe(Effect.provide(failedLayer))
  )

  it.effect("serializes infrastructure causes as diagnostics, not restored domain errors or raw causes", () =>
    Effect.gen(function* () {
      const router = yield* App.service
      yield* router.awaitInitial
      const state = yield* router.state
      const snapshot = toState(
        "Snapshot",
        {
          ...state,
          presentation: Option.some({
            _tag: "Failed",
            attempt: 2,
            location: Option.getOrThrow(state.location),
            entries: [],
            owner: "<router>",
            cause: Cause.die(new Error("defect"))
          })
        },
        new Map()
      )
      expect(snapshot).toMatchObject({ display: "RouterFailure", diagnostic: { reasons: ["Defect"] } })
      expect(snapshot).not.toHaveProperty("cause")
      expect(() => Schema.encodeSync(Schema.fromJsonString(State))(snapshot)).not.toThrow()
    }).pipe(Effect.provide(layer))
  )
})
