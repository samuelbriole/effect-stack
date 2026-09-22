import * as Schema from "effect/Schema"
import { expect, test } from "tstyche"
import * as Router from "@effect-stack/router/Router"
import type { RouteResult, Views } from "@effect-stack/router-react"
import { useRoute } from "@effect-stack/router-react"

const Routes = Router.schema("App", {
  home: "/",
  project: {
    path: "/projects/:projectId",
    params: { projectId: Schema.FiniteFromString },
    success: Schema.Struct({ title: Schema.String })
  }
})

test("useRoute returns the contract's typed data", () => {
  expect(useRoute(Routes.project)).type.toBe<RouteResult<typeof Routes.project>>()
})

test("view records mirror the contract grouping", () => {
  const views = {
    home: () => null,
    project: { component: () => null }
  }
  expect(views).type.toBeAssignableTo<Views<typeof Routes>>()
})
