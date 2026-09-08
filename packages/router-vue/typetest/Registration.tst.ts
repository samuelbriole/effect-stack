import {
  createRootRoute,
  createRoute,
  createRouter,
  type Link,
  type Navigate,
  type useNavigate,
  type useRouter,
  type useRouterState
} from "@effect-stack/router-vue"
import { Schema } from "effect"
import type { Atom } from "effect/unstable/reactivity"
import { describe, expect, test } from "tstyche"
import type { Ref } from "vue"

const root = createRootRoute()
const project = createRoute({
  getParentRoute: () => root,
  path: "projects/:id",
  params: { id: Schema.FiniteFromString },
  search: { tab: Schema.optionalKey(Schema.String) }
})
const child = createRoute({ getParentRoute: () => root, path: "child" })
const router = createRouter({ routeTree: root.addChildren([project, child]) })

declare module "@effect-stack/router-vue" {
  interface Register {
    router: typeof router
  }
}

const linkProps = (props: Parameters<typeof Link>[0]) => props
const navigateProps = (props: Parameters<typeof Navigate>[0]) => props
declare const navigate: ReturnType<typeof useNavigate>

describe("Vue registered component inference", () => {
  test("carries registered routes through composables and component props", () => {
    expect<ReturnType<typeof useRouter>>().type.toBe<typeof router>()
    expect<ReturnType<typeof useRouterState>>().type.toBe<Readonly<Ref<Atom.Type<typeof router.core.state>>>>()
    expect(linkProps).type.toBeCallableWith({
      to: "/projects/:id",
      params: { id: 42 },
      class: "link",
      target: "_blank"
    })
    expect(linkProps).type.toBeCallableWith({ to: "/", onClick: [(event: MouseEvent) => event.preventDefault()] })
    expect(linkProps).type.not.toBeCallableWith({ to: "/missing" })
    expect(linkProps).type.not.toBeCallableWith({ to: "/projects/:id" })
    expect(linkProps).type.not.toBeCallableWith({ to: "/projects/:id", params: { id: "42" } })
    expect(navigateProps).type.toBeCallableWith({ to: "/child", replace: true, state: { acknowledged: true } })
    expect(navigateProps).type.not.toBeCallableWith({ to: "/projects/:id" })
    expect(navigate).type.toBeCallableWith({ to: project.to, params: { id: 42 } })
    expect(navigate).type.not.toBeCallableWith({ to: "/missing" })
  })
})
