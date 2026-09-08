import { createRootRoute, createRoute, type Destination } from "@effect-stack/router-react"
import { Schema } from "effect"
import { describe, expect, test } from "tstyche"

const root = createRootRoute()
const dashboard = createRoute({ getParentRoute: () => root, path: "dashboard" })
const dashboardIndex = createRoute({
  getParentRoute: () => dashboard,
  path: "/",
  search: { page: Schema.FiniteFromString },
  hash: Schema.Literals(["top", "details"])
})
const dashboardModal = createRoute({
  getParentRoute: () => dashboard,
  id: "modal",
  search: { modal: Schema.optionalKey(Schema.String) }
})
const settings = createRoute({ getParentRoute: () => root, path: "settings" })
const gallery = createRoute({ getParentRoute: () => root, id: "gallery" })
const home = createRoute({
  getParentRoute: () => gallery,
  path: "/",
  search: { view: Schema.FiniteFromString }
})
const user = createRoute({
  getParentRoute: () => root,
  path: "user/:id",
  params: { id: Schema.FiniteFromString }
})
const userLayout = createRoute({ getParentRoute: () => user, id: "shell" })
const userIndex = createRoute({
  getParentRoute: () => userLayout,
  path: "/",
  search: { tab: Schema.String }
})
const tree = root.addChildren([
  dashboard.addChildren([dashboardIndex, dashboardModal]),
  gallery.addChildren([home]),
  settings,
  user.addChildren([userLayout.addChildren([userIndex])])
])
const destination = (value: Destination<typeof tree>) => value

describe("Destinations for routes sharing one URL", () => {
  test("an ancestor or pathless layout cannot bypass the index required search and hash", () => {
    expect(destination).type.toBeCallableWith({ to: "/dashboard", search: { page: 1 }, hash: "top" })
    expect(destination).type.not.toBeCallableWith({ to: "/dashboard" })
    expect(destination).type.not.toBeCallableWith({ to: "/dashboard", search: { page: 1 } })
    expect(destination).type.not.toBeCallableWith({ to: "/dashboard", hash: "top" })
    expect(destination).type.not.toBeCallableWith({ to: "/dashboard", search: { page: "1" }, hash: "top" })
  })
  test("an index below a pathless layout ranks above the root it shares a URL with", () => {
    expect(destination).type.toBeCallableWith({ to: "/", search: { view: 2 } })
    expect(destination).type.not.toBeCallableWith({ to: "/" })
  })
  test("routes without a same-URL leaf keep their own optional requirements", () => {
    expect(destination).type.toBeCallableWith({ to: "/settings" })
  })
  test("a non-root index inherits params through a pathless layout and adds its own search", () => {
    expect(destination).type.toBeCallableWith({ to: "/user/:id", params: { id: 42 }, search: { tab: "one" } })
    expect(destination).type.not.toBeCallableWith({ to: "/user/:id", params: { id: 42 } })
    expect(destination).type.not.toBeCallableWith({ to: "/user/:id", search: { tab: "one" } })
  })
})
