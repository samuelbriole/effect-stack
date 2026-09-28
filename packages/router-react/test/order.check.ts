import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import type * as Router from "@effect-stack/router/Router"
import { route, useRouteInput } from "@effect-stack/router-react"
import type { ReactNode } from "react"

const Id = Schema.FiniteFromString.pipe(Schema.brand("OrderId"))
class Dep extends Context.Service<Dep, {}>()("check/OrderDep") {}
class Failure extends Schema.TaggedError<Failure>()("OrderFailure", {}) {}
const ComponentFirst = route("componentFirst", "/:id", {
  component: (): ReactNode => String(useRouteInput(ComponentFirst).params.id),
  params: { id: Id },
  prepare: ({ params }) =>
    Effect.sync(() => {
      const id: typeof Id.Type = params.id
      void id
    })
})
const ErrorFirst = route("errorFirst", "/error/:id", {
  error: ({ failure }) => (failure._tag === "Domain" ? String(failure.error) : null),
  component: () => null,
  params: { id: Id },
  prepare: () => Effect.andThen(Dep, Effect.fail(new Failure()))
})
const error: Router.ErrorOf<typeof ErrorFirst> = new Failure()
declare const dep: Dep
const requirement: Router.RequirementsOf<typeof ErrorFirst> = dep
void error
void requirement
// @ts-expect-error success components have no mandatory injected props
route("props", "/props", { component: ({ data }: { data: string }) => data })
