import { Router, RouteTree } from "@effect-stack/router"
import { Schema } from "effect"
import { expect, test } from "tstyche"

const root = RouteTree.root()
const numeric = RouteTree.make({ getParentRoute: () => root, path: "a/:id", params: { id: Schema.FiniteFromString } })
const slug = RouteTree.make({ getParentRoute: () => root, path: "b/:slug", params: { slug: Schema.String } })
const tree = root.addChildren([numeric, slug])
const command = (value: Router.Command<ReadonlyArray<RouteTree.All<typeof tree>>>) => value

test("nested commands preserve route/input correlation", () => {
  expect(command).type.toBeCallableWith({
    _tag: "To",
    route: numeric,
    input: { params: { id: 42 }, search: {}, hash: "" },
    replace: false
  })
  expect(command).type.not.toBeCallableWith({
    _tag: "To",
    route: numeric,
    input: { params: { slug: "wrong" }, search: {}, hash: "" },
    replace: false
  })
})
test("generic failure constructors establish their declared types", () => {
  const error = new Router.RouteLoaderError({ routeId: "projects", error: 42 })
  expect(error.routeId).type.toBe<"projects">()
  expect(error.error).type.toBe<number>()
  expect(Router.RouteLoaderError<"projects", number>).type.not.toBeConstructableWith({
    routeId: "other",
    error: "wrong"
  })
  expect(Router.RouteLoadError<"projects", number>).type.not.toBeConstructableWith({
    routeId: "projects",
    error: "wrong"
  })
})
