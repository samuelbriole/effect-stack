import { describe, expect, it } from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import { MemoryHistory, Router } from "@effect-stack/router"
import {
  NotFoundFailureOwner,
  outletDecision,
  projectPresentation,
  selectOutlet,
  type PresentationState,
  type ViewShape
} from "@effect-stack/router/Presentation"

const Parent = Router.layout("parent", "/parent")
const Child = Parent.route("child", "/child")
const Failed = Parent.route("failed", "/failed", { prepare: () => Effect.fail("gate failure") })
const App = Router.make("DisplaySnapshot", [Child, Failed])
const layer = App.layer.pipe(Layer.provide(MemoryHistory.layer("/parent/child")))
const fallback = { error: "fallback" }
const views = new Map<string, ViewShape>([
  [Parent.id, { component: "parent" }],
  [Child.id, { component: "child" }],
  [Failed.id, { component: "failed", error: "error" }]
])

const assertEquivalent = (state: PresentationState, lookup = views) => {
  const snapshot = projectPresentation(state)
  for (let depth = 0; depth < 4; depth++) {
    const old = outletDecision(state, depth, lookup, fallback)
    const selected = selectOutlet(snapshot, depth, lookup, fallback)
    if (old._tag === "View" || old._tag === "Failure") {
      expect(selected).toEqual({
        ...old,
        entry: { ...old.entry, failure: old._tag === "Failure" ? old.failure : null }
      })
    } else {
      expect(selected).toEqual(old)
    }
  }
}

describe("renderer-neutral snapshots", () => {
  it.effect("projects empty, initial pending, and retained pending with old decoded inputs", () =>
    Effect.gen(function* () {
      const router = yield* App.service
      yield* router.awaitInitial
      const state = yield* router.state
      const location = Option.getOrThrow(state.location)
      const empty = { ...state, presentation: Option.none() }
      expect(projectPresentation(empty)).toEqual({ _tag: "Empty", entries: [] })
      assertEquivalent(empty)
      const pending = {
        ...state,
        presentation: Option.some({ _tag: "Pending" as const, attempt: 2, location })
      }
      const initial = { ...pending, resolved: Option.none() }
      expect(projectPresentation(initial)).toEqual({ _tag: "Pending", entries: [] })
      assertEquivalent(initial)
      expect(projectPresentation(pending)).toEqual(projectPresentation(state))
      expect(projectPresentation(pending).entries.map((entry) => entry.id)).toEqual([Parent.id, Child.id])
      assertEquivalent(pending)
    }).pipe(Effect.provide(layer))
  )

  it.effect("keeps parents, presents only the failed owner, and lets errors replace empty subtrees", () =>
    Effect.gen(function* () {
      const router = yield* App.service
      yield* router.awaitInitial
      yield* Effect.exit(router.navigate(Failed.to()))
      const state = yield* router.state
      const snapshot = projectPresentation(state)
      expect(snapshot._tag).toBe("Entries")
      expect(snapshot.entries.map((entry) => entry.failure)).toEqual([null, { _tag: "Domain", error: "gate failure" }])
      expect(selectOutlet(snapshot, 0, views, fallback)._tag).toBe("View")
      const emptyFailed = new Map(views).set(Failed.id, { empty: true })
      expect(selectOutlet(snapshot, 1, emptyFailed, fallback)).toMatchObject({ _tag: "Failure", nextDepth: 2 })
      assertEquivalent(state)
      assertEquivalent(state, emptyFailed)
      const noErrorView = new Map(views)
      noErrorView.delete(Failed.id)
      expect(selectOutlet(snapshot, 1, noErrorView, fallback)).toMatchObject({ _tag: "Failure", view: fallback })
      assertEquivalent(state, noErrorView)
      const presentation = Option.getOrThrow(state.presentation)
      if (presentation._tag !== "Failed") throw new Error("expected failure")
      const nonOwner = { ...state, presentation: Option.some({ ...presentation, owner: Parent.id }) }
      expect(projectPresentation(nonOwner).entries.every((entry) => entry.failure === null)).toBe(true)
      assertEquivalent(nonOwner)
    }).pipe(Effect.provide(layer))
  )

  it.effect("classifies not found and ownerless router failures at the correct depths", () =>
    Effect.gen(function* () {
      const router = yield* App.service
      yield* router.awaitInitial
      const state = yield* router.state
      const failure = {
        _tag: "Failed" as const,
        attempt: 2,
        location: Option.getOrThrow(state.location),
        entries: Option.getOrThrow(state.resolved).entries,
        owner: NotFoundFailureOwner,
        cause: Cause.die("router defect")
      }
      const notFound = { ...state, presentation: Option.some(failure) }
      expect(projectPresentation(notFound)).toEqual({ _tag: "NotFound", entries: [] })
      assertEquivalent(notFound)
      const ownerless = { ...state, presentation: Option.some({ ...failure, owner: "<router>" }) }
      expect(projectPresentation(ownerless)).toEqual({
        _tag: "RouterFailure",
        entries: [],
        failure: { _tag: "Cause", cause: failure.cause }
      })
      assertEquivalent(ownerless)
    }).pipe(Effect.provide(layer))
  )

  it.effect("traverses transparent layouts, advances depth, and terminates at explicit empty views", () =>
    Effect.gen(function* () {
      const router = yield* App.service
      yield* router.awaitInitial
      const state = yield* router.state
      const transparent = new Map(views)
      transparent.delete(Parent.id)
      expect(selectOutlet(projectPresentation(state), 0, transparent, fallback)).toMatchObject({
        _tag: "View",
        nextDepth: 2,
        entry: { id: Child.id }
      })
      assertEquivalent(state, transparent)
      const empty = new Map(views).set(Parent.id, { empty: true, component: "ignored" })
      expect(selectOutlet(projectPresentation(state), 0, empty, fallback)).toEqual({ _tag: "Empty" })
      assertEquivalent(state, empty)
    }).pipe(Effect.provide(layer))
  )

  it("selects node-independent entries and preserves their identity", () => {
    const entry = { id: "native", input: 42, failure: "native failure" }
    expect(selectOutlet({ _tag: "Entries", entries: [entry] }, 0, new Map(), fallback)).toEqual({
      _tag: "Failure",
      nextDepth: 1,
      entry,
      view: fallback,
      failure: "native failure"
    })
  })
})
