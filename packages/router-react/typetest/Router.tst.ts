import * as Schema from "effect/Schema"
import { expect, test } from "tstyche"
import * as Router from "@effect-stack/router/Router"
import * as Route from "@effect-stack/router/Route"
import * as RouteGroup from "@effect-stack/router/RouteGroup"
import type { RouteResult, Views } from "@effect-stack/router-react"
import { useRoute } from "@effect-stack/router-react"

const ProjectId = Schema.FiniteFromString

const Routes = Router.make("App").add(
  Route.make("home", "/"),
  Route.make("project", "/projects/:projectId", {
    params: { projectId: ProjectId },
    success: Schema.Struct({ title: Schema.String })
  })
)

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

const Grouped = Router.make("Grouped").add(
  Route.make("home", "/"),
  RouteGroup.make("areas")
    .add(
      Route.make("detail", "/:areaId", {
        params: { areaId: ProjectId },
        success: Schema.Struct({ name: Schema.String })
      })
    )
    .prefix("/areas")
)

test("group views require nested children and ignore builder metadata", () => {
  const views = {
    home: () => null,
    areas: { children: { detail: () => null } }
  }
  expect(views).type.toBeAssignableTo<Views<typeof Grouped>>()
  // A flat record that omits group children is not a valid view record.
  expect({ home: () => null, areas: () => null }).type.not.toBeAssignableTo<Views<typeof Grouped>>()
})
