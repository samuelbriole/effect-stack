import { Link, Outlet, useRoute, type Views } from "@effect-stack/router-vue"
import { AppLive, projectId42, Routes } from "@effect-stack-example/router-shared"
import { Atom } from "effect/unstable/reactivity"
import { defineComponent, h, ref } from "vue"

export const runtime = Atom.runtime(AppLive)

const Nav = defineComponent({
  name: "ExampleNav",
  setup() {
    return () =>
      h("nav", [
        h(Link, { to: Routes.home() }, { default: () => "Home" }),
        h(Link, { to: Routes.project({ params: { projectId: projectId42 } }) }, { default: () => "Project 42" }),
        h(Link, { to: Routes.slow() }, { default: () => "Slow" })
      ])
  }
})

const HomePage = defineComponent({
  name: "HomePage",
  setup() {
    return () => h("section", [h(Nav), h("h2", "Home"), h("p", "Native Effect handlers and typed Vue navigation.")])
  }
})

const ProjectPending = defineComponent({
  name: "ProjectPending",
  setup: () => () => h("p", { role: "status" }, "Loading project…")
})

const ProjectBoundary = defineComponent({
  name: "ProjectBoundary",
  props: { error: { type: null, required: true }, reset: { type: Function, required: true } },
  setup(props) {
    return () =>
      h("section", [
        h(Nav),
        h("h3", "Project failed"),
        h("pre", String(props.error)),
        h("button", { onClick: props.reset as () => void }, "Retry")
      ])
  }
})

const ProjectPage = defineComponent({
  name: "ProjectPage",
  setup() {
    const route = useRoute(Routes.project)
    const count = ref(0)
    return () =>
      h("section", [
        h(Nav),
        h("h2", route.value.data.title),
        h("p", `id ${route.value.params.projectId} · tab ${route.value.search.tab ?? "overview"}`),
        h("button", { onClick: () => (count.value += 1) }, `Layout counter: ${count.value}`),
        h("nav", [
          h(
            Link,
            { to: Routes.project({ params: route.value.params, search: route.value.search }) },
            { default: () => "Overview" }
          ),
          h(Link, { to: Routes.details({ params: route.value.params }) }, { default: () => "Details" })
        ]),
        h(Outlet)
      ])
  }
})

const DetailsPage = defineComponent({
  name: "DetailsPage",
  setup: () => () => h("p", "This view is rendered through a nested layout Outlet.")
})

const SlowPage = defineComponent({
  name: "SlowPage",
  setup: () => () => h("p", "The slow route finished preparing.")
})

export const views = {
  home: HomePage,
  project: { component: ProjectPage, pending: ProjectPending, error: ProjectBoundary },
  details: DetailsPage,
  slow: { component: SlowPage, pending: () => h("p", { role: "status" }, "Preparing…") }
} satisfies Views<typeof Routes>
