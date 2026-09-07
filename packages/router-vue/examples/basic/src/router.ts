import { createRootRoute, createRoute, createRouter, type ErrorProps, Link } from "@effect-stack/router-vue"
import { Effect, Schema } from "effect"
import { h, type VNode } from "vue"
import Layout from "./Layout.vue"
import ProjectLayout from "./ProjectLayout.vue"
import { demoLayer, Projects } from "./Projects.ts"

const rootRoute = createRootRoute({
  component: Layout,
  pendingComponent: () => h("p", { role: "status" }, "Loading route…"),
  notFoundComponent: (): VNode => h("main", [h("h1", "Page not found"), h(Link, { to: "/" }, () => "Home")]),
  errorComponent: (props: ErrorProps): VNode =>
    h("main", [
      h("h1", "Route failed"),
      h("pre", String(props.error)),
      h("button", { onClick: props.reset }, "Retry"),
      h(Link, { to: "/" }, () => "Home")
    ])
})
const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => h("section", [h("h2", "Home"), h("p", "Native Effect loaders and typed Vue navigation.")])
})
export const projectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "projects/:projectId",
  params: { projectId: Schema.FiniteFromString },
  search: { tab: Schema.optionalKey(Schema.Literals(["overview", "activity"])) },
  loader: ({ params }) => Projects.use((projects) => projects.get(params.projectId)),
  component: ProjectLayout
})
const projectIndex = createRoute({
  getParentRoute: () => projectRoute,
  path: "/",
  component: () => h("p", "Project overview")
})
const detailsRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "details",
  load: () => Effect.promise(() => import("./ProjectDetails.vue")),
  pendingComponent: () => h("p", { role: "status" }, "Loading details…")
})
export const router = createRouter({
  routeTree: rootRoute.addChildren([homeRoute, projectRoute.addChildren([projectIndex, detailsRoute])]),
  layer: demoLayer
})

declare module "@effect-stack/router-vue" {
  interface Register {
    router: typeof router
  }
}
