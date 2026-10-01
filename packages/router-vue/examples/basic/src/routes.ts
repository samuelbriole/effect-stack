import { Outlet, layout, make, route, useRouteInput } from "@effect-stack/router-vue"
import { injectRegistry, useAtomValue } from "@effect/atom-vue"
import * as BrowserHistory from "@effect-stack/router/BrowserHistory"
import { Context, Effect, Layer, Schema } from "effect"
import { Atom, AsyncResult } from "effect/reactivity"
import { computed, defineComponent, h, type VNodeChild } from "vue"
import { Link } from "./navigation.ts"

/** URL-decoded project identifier. @since 0.4.0 */
export const ProjectId = Schema.FiniteFromString.pipe(Schema.brand("ProjectId"))
/** @since 0.4.0 */
export type ProjectId = typeof ProjectId.Type
/** @since 0.4.0 */
export const projectId = Schema.decodeUnknownSync(ProjectId)("42")
/** @since 0.4.0 */
export const failingProjectId = Schema.decodeUnknownSync(ProjectId)("13")
/** @since 0.4.0 */
export const ProjectData = Schema.Struct({ id: Schema.Number, title: Schema.String })
/** @since 0.4.0 */
export type ProjectData = typeof ProjectData.Type
/** @since 0.4.0 */
export class ProjectNotFound extends Schema.TaggedError<ProjectNotFound>()("ProjectNotFound", {
  projectId: Schema.Number
}) {}
/** @since 0.4.0 */
export class Projects extends Context.Service<
  Projects,
  { readonly get: (id: ProjectId) => Effect.Effect<ProjectData, ProjectNotFound> }
>()("example/Projects") {}
/** @since 0.4.0 */
export const demoProjectsLayer = Layer.sync(Projects, () => {
  let failed = false
  return Projects.of({
    get: Effect.fn("Projects.get")(function* (id: ProjectId) {
      yield* Effect.sleep("200 millis")
      if (id === 13 && !failed) {
        failed = true
        return yield* Effect.fail(new ProjectNotFound({ projectId: id }))
      }
      return { id, title: `Project ${id}` }
    })
  })
})
const Nav = defineComponent({
  setup: () => (): VNodeChild =>
    h("nav", [
      h(Link, { to: "/" }, { default: () => "Home" }),
      h(Link, { to: "/projects/:projectId", params: { projectId } }, { default: () => "Project 42" }),
      h(
        Link,
        { to: "/projects/:projectId", params: { projectId: failingProjectId } },
        { default: () => "Failing project" }
      ),
      h(Link, { to: "/slow" }, { default: () => "Slow" })
    ])
})
const HomePage = defineComponent({
  setup: () => (): VNodeChild =>
    h("section", [h(Nav), h("h2", "Home"), h("p", "Atom-owned resources and typed Vue navigation.")])
})
const ProjectPage = defineComponent({
  setup(): () => VNodeChild {
    const input = useRouteInput(Project)
    const selected = computed(() => projectResource(input.value.params.projectId))
    const result = useAtomValue(() => selected.value)
    const registry = injectRegistry()
    const refresh = () => registry.refresh(selected.value)
    return () => {
      const value = result.value
      const content = AsyncResult.isInitial(value)
        ? h("p", { role: "status" }, "Loading project…")
        : AsyncResult.isFailure(value)
          ? h("section", [
              h("h3", "Project failed"),
              h("pre", String(value.cause)),
              h("button", { onClick: refresh }, "Retry resource")
            ])
          : h("h2", value.value.title)
      return h("section", [
        h(Nav),
        content,
        h("button", { onClick: refresh }, "Refresh resource"),
        h("p", `id ${input.value.params.projectId}`),
        h("nav", [
          h(
            Link,
            { to: "/projects/:projectId", params: { projectId: input.value.params.projectId } },
            { default: () => "Overview" }
          ),
          h(
            Link,
            { to: "/projects/:projectId/details", params: { projectId: input.value.params.projectId } },
            { default: () => "Details" }
          )
        ]),
        h(Outlet)
      ])
    }
  }
})
const OverviewPage = defineComponent({
  setup(): () => VNodeChild {
    const input = useRouteInput(ProjectIndex)
    return () => h("p", `This is the project overview. tab ${input.value.search.tab ?? "overview"}`)
  }
})
/** @since 0.4.0 */
export const Home = route("home", "/", { component: HomePage })
/** @since 0.4.0 */
export const Project = layout("project", "/projects/:projectId", {
  params: { projectId: ProjectId },
  component: ProjectPage
})
/** @since 0.4.0 */
export const ProjectIndex = Project.index({
  search: { tab: Schema.optionalKey(Schema.Literals(["overview", "activity"])) },
  component: OverviewPage
})
/** @since 0.4.0 */
export const ProjectDetails = Project.route("details", "/details", {
  render: () => h("p", "This view is rendered through a nested layout Outlet.")
})
/** @since 0.4.0 */
export const Slow = route("slow", "/slow", {
  prepare: () => Effect.sleep("1 seconds"),
  render: () => h("p", "The slow route finished preparing.")
})

/** The canonical selected application. @since 0.4.0 */
export const Application = make("Example", [Home, ProjectIndex, ProjectDetails, Slow])

/** One service context for navigation gates and application resources. @since 0.4.0 */
export const runtime = Atom.runtime(
  Application.layer.pipe(Layer.provideMerge(Layer.merge(BrowserHistory.layer, demoProjectsLayer)))
)

/** Application-owned resources using the shared runtime. @since 0.4.0 */
export const projectResource = Atom.family((id: ProjectId) =>
  runtime.atom(Projects.use((projects) => projects.get(id)))
)
