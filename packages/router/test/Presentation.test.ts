import { describe, expect, it } from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { MemoryHistory, Router } from "@effect-stack/router"
import { displayEntries, entryFailure, outletDecision, toDisplayEntry } from "@effect-stack/router/Presentation"

class DomainError extends Schema.TaggedError<DomainError>()("DomainError", { id: Schema.Number }) {}

const OtherGo = Router.route("go", "/go")

const Boom = Router.route("boom", "/boom", { prepare: () => Effect.fail(new DomainError({ id: 1 })) })
const Defect = Router.route("defect", "/defect", { prepare: () => Effect.die(new Error("defect")) })
const ForeignRedirect = Router.route("foreignRedirect", "/foreign-redirect", {
  prepare: () => Effect.fail(Router.redirect(OtherGo.to()) as never)
})
const Decode = Router.route("decode", "/decode/:id", { params: { id: Schema.Literals(["ok"]) } })
const loopTargets: { loopy?: Router.Destination<unknown>; loopb?: Router.Destination<unknown> } = {}
const Loopa = Router.route("loopa", "/loopa", {
  prepare: () => Effect.fail(Router.redirect(loopTargets.loopb as Router.Destination<unknown>))
})
const Loopb = Router.route("loopb", "/loopb", {
  prepare: () => Effect.fail(Router.redirect(loopTargets.loopy as Router.Destination<unknown>))
})
loopTargets.loopy = Loopa.to()
loopTargets.loopb = Loopb.to()

const App = Router.make("Classify", [Boom, Defect, ForeignRedirect, Decode, Loopa, Loopb])
const makeApp = (initial: string) => App.layer.pipe(Layer.provide(MemoryHistory.layer(initial)))

const failedPresentation = (state: Router.RouterState<unknown>) => {
  const presentation = Option.getOrThrow(state.presentation)
  if (presentation._tag !== "Failed") throw new Error("expected a failed presentation")
  return presentation
}

describe("failure classification", () => {
  it.effect("classifies a pure gate failure as a domain failure", () =>
    Effect.gen(function* () {
      const router = yield* App.service
      yield* Effect.exit(router.navigate(Boom.to()))
      const state = yield* router.state
      const presentation = failedPresentation(state)
      const entry = presentation.entries.find((candidate) => candidate.id === "boom")
      expect(entry).toBeDefined()
      if (entry === undefined) return
      expect(entry.domain).toBe(true)
      const failure = Option.getOrThrow(entryFailure(entry))
      expect(failure._tag).toBe("Domain")
    }).pipe(Effect.provide(makeApp("/")))
  )

  it.effect("classifies a decode failure as a cause, not a domain failure", () =>
    Effect.gen(function* () {
      const router = yield* App.service
      yield* router.awaitInitial.pipe(Effect.exit)
      const state = yield* router.state
      const presentation = failedPresentation(state)
      expect(presentation.owner).toBe("decode")
      const entry = presentation.entries.find((candidate) => candidate.id === "decode")
      if (entry === undefined) throw new Error("missing entry")
      expect(entry.domain).toBe(false)
      expect(Option.getOrThrow(entryFailure(entry))._tag).toBe("Cause")
    }).pipe(Effect.provide(makeApp("/decode/nope")))
  )

  it.effect("attributes an engine-generated foreign redirect failure as a cause", () =>
    Effect.gen(function* () {
      const router = yield* App.service
      yield* Effect.exit(router.navigate(ForeignRedirect.to()))
      const state = yield* router.state
      const presentation = failedPresentation(state)
      expect(presentation.owner).toBe("foreignRedirect")
      const entry = presentation.entries.find((candidate) => candidate.id === "foreignRedirect")
      if (entry === undefined) throw new Error("missing entry")
      expect(entry.domain).toBe(false)
      expect(Option.getOrThrow(entryFailure(entry))._tag).toBe("Cause")
    }).pipe(Effect.provide(makeApp("/")))
  )

  it.effect("classifies a gate defect as a cause with the defect preserved", () =>
    Effect.gen(function* () {
      const router = yield* App.service
      yield* Effect.exit(router.navigate(Defect.to()))
      const state = yield* router.state
      const presentation = failedPresentation(state)
      const entry = presentation.entries.find((candidate) => candidate.id === "defect")
      if (entry === undefined) throw new Error("missing entry")
      expect(entry.domain).toBe(false)
      const failure = Option.getOrThrow(entryFailure(entry))
      expect(failure._tag).toBe("Cause")
      if (failure._tag === "Cause") expect(failure.cause.reasons.some(Cause.isDieReason)).toBe(true)
      expect(Option.isSome(toDisplayEntry(entry).input)).toBe(true)
    }).pipe(Effect.provide(makeApp("/")))
  )

  it.effect("preserves the full router-level cause for a redirect loop", () =>
    Effect.gen(function* () {
      const router = yield* App.service
      yield* Effect.exit(router.navigate(Loopa.to()))
      const state = yield* router.state
      const presentation = failedPresentation(state)
      expect(presentation.owner).toBe("<router>")
      expect(presentation.cause.reasons.some(Cause.isFailReason)).toBe(true)
    }).pipe(Effect.provide(makeApp("/")))
  )
})

describe("branch-level presentation", () => {
  it.effect("initial pending exposes no incoming entries and only the root pending decision", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const Item = Router.route("item", "/items/:id", {
        params: { id: Schema.FiniteFromString },
        prepare: () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(release)))
      })
      const LocalApp = Router.make("InitialPending", [Item])
      yield* Effect.gen(function* () {
        const router = yield* LocalApp.service
        yield* Deferred.await(started)
        const state = yield* router.state
        const presentation = Option.getOrThrow(state.presentation)
        expect(presentation).toEqual({
          _tag: "Pending",
          attempt: state.status._tag === "Pending" ? state.status.attempt : -1,
          location: Option.getOrThrow(state.location)
        })
        expect(displayEntries(state)).toEqual([])
        const views = new Map<string, { readonly component?: string }>([[Item.id, { component: "item" }]])
        expect(outletDecision(state, 0, views, {})).toEqual({ _tag: "Pending" })
        expect(outletDecision(state, 1, views, {})).toEqual({ _tag: "Empty" })
        yield* Deferred.succeed(release, undefined)
        yield* router.awaitInitial
        expect(displayEntries(yield* router.state).map((entry) => entry.id)).toEqual([Item.id])
      }).pipe(Effect.provide(LocalApp.layer.pipe(Layer.provide(MemoryHistory.layer("/items/2")))))
    })
  )

  it.effect("retains the entire displayed branch and old inputs through each incoming preparation stage", () =>
    Effect.gen(function* () {
      const parentStarted = yield* Deferred.make<void>()
      const parentRelease = yield* Deferred.make<void>()
      const childStarted = yield* Deferred.make<void>()
      const childRelease = yield* Deferred.make<void>()
      const Parent = Router.layout("parent", "/items/:id", {
        params: { id: Schema.FiniteFromString },
        prepare: ({ params }) =>
          params.id === 2
            ? Deferred.succeed(parentStarted, undefined).pipe(Effect.andThen(Deferred.await(parentRelease)))
            : Effect.void
      })
      const Child = Parent.route("overview", "/", {
        prepare: ({ params }) =>
          params.id === 2
            ? Deferred.succeed(childStarted, undefined).pipe(Effect.andThen(Deferred.await(childRelease)))
            : Effect.void
      })
      const LocalApp = Router.make("RetainedBranch", [Child])
      yield* Effect.gen(function* () {
        const router = yield* LocalApp.service
        yield* router.awaitInitial
        const original = yield* router.state
        const entries = displayEntries(original)
        const childEntry = entries[1]
        if (childEntry === undefined) throw new Error("missing child entry")
        const views = new Map<string, { readonly component?: string }>([[Child.id, { component: "child" }]])
        const decision = outletDecision(original, 0, views, {})
        expect(decision._tag).toBe("View")
        expect(decision._tag === "View" && decision.nextDepth).toBe(2)
        const handle = yield* router.submit(Child.to({ params: { id: 2 } }))
        yield* Deferred.await(parentStarted)
        const assertRetained = (state: Router.RouterState<unknown>) => {
          expect(Option.getOrThrow(state.presentation)._tag).toBe("Pending")
          expect(displayEntries(state)).toBe(entries)
          expect(outletDecision(state, 0, views, {})).toEqual(decision)
          expect(Option.getOrThrow(toDisplayEntry(childEntry).input)).toMatchObject({ params: { id: 1 } })
        }
        assertRetained(yield* router.state)
        yield* Deferred.succeed(parentRelease, undefined)
        yield* Deferred.await(childStarted)
        assertRetained(yield* router.state)
        yield* Deferred.succeed(childRelease, undefined)
        expect(yield* handle.await).toBe("Committed")
        const committed = displayEntries(yield* router.state)
        expect(committed).not.toBe(entries)
        expect(committed.map((entry) => Option.getOrThrow(toDisplayEntry(entry).input))).toMatchObject([
          { params: { id: 2 } },
          { params: { id: 2 } }
        ])
        const emptyViews = new Map<string, { readonly empty?: true }>([[Child.id, { empty: true }]])
        expect(outletDecision(yield* router.state, 0, emptyViews, {})).toEqual({
          _tag: "Empty"
        })
      }).pipe(Effect.provide(LocalApp.layer.pipe(Layer.provide(MemoryHistory.layer("/items/1")))))
    })
  )
})
