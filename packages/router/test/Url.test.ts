import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import { MemoryHistory, Router } from "@effect-stack/router"

const Routes = Router.schema("Url", {
  item: {
    path: "/items/:id",
    params: { id: Schema.String },
    search: { q: Schema.optionalKey(Schema.String) },
    hash: Schema.String,
    success: Schema.Struct({ id: Schema.String })
  }
})

const ItemLive = Router.route(Routes.item, ({ params }) => Effect.succeed({ id: params.id }))

const makeApp = (initial: string) =>
  Router.layer(Routes).pipe(Layer.provide(ItemLive), Layer.provide(MemoryHistory.layer(initial)))

describe("URL contracts", () => {
  it("round-trips unicode params, search, and hash", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const router = yield* Routes.service
        const destination = Routes.item({
          params: { id: "héllo wörld/🎉" },
          search: { q: "a+b c" },
          hash: "section"
        })
        const href = Result.getOrThrow(Router.href(destination))
        yield* router.navigate(destination)
        const state = yield* router.state
        const presentation = Option.getOrThrow(state.presentation)
        const entry = presentation.entries.find((candidate) => candidate.id === "item")
        expect(entry).toBeDefined()
        expect(entry === undefined ? undefined : AsyncResult.value(entry.data)).toEqual(
          Option.some({ id: "héllo wörld/🎉" })
        )
        expect(entry === undefined ? undefined : Result.getOrThrow(entry.input)).toMatchObject({
          params: { id: "héllo wörld/🎉" },
          search: { q: "a+b c" },
          hash: "section"
        })
        expect(href).toContain("/items/")
      }).pipe(Effect.provide(makeApp("/")))
    ))

  it.effect("reports malformed percent-encoding without failing the Layer", () =>
    Effect.gen(function* () {
      const router = yield* Routes.service
      yield* router.awaitInitial.pipe(Effect.exit)
      const state = yield* router.state
      const presentation = Option.getOrThrow(state.presentation)
      expect(presentation._tag).toBe("Failed")
    }).pipe(Effect.provide(makeApp("/items/%E0%A4%A")))
  )
})
