/**
 * Compile-time native React inference checks. Typechecked by `pnpm check`; not
 * run by Vitest or TSTyche.
 */
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as React from "react"
import * as Router from "@effect-stack/router/Router"
import {
  make,
  useRouteInput,
  layout,
  route,
  type DirectOptions,
  type LinkProps,
  type PresentationOptions
} from "@effect-stack/router-react"

const WorkspaceId = Schema.FiniteFromString.pipe(Schema.brand("WorkspaceId"))
const ProjectId = Schema.FiniteFromString.pipe(Schema.brand("ProjectId"))
const workspaceId = Schema.decodeUnknownSync(WorkspaceId)(1)
const projectId = Schema.decodeUnknownSync(ProjectId)(2)

const Home = route("home", "/", { component: () => null })

const Workspace = layout("workspace", "/workspaces/:workspaceId", {
  params: { workspaceId: WorkspaceId },
  component: () => null
})

// Params, prepare, and component retain contextual decoded input inference.
const Project = Workspace.route("project", "/projects/:projectId", {
  params: { projectId: ProjectId },
  prepare: ({ params }) =>
    Effect.sync(() => {
      void params.workspaceId
      void params.projectId
    }),
  component: () => null
})

const App = make("React", [Home, Project])
void App

// Native components receive no router-owned data props.
const badOptions: DirectOptions<{}, {}, undefined, never, never> = {
  prepare: () => Effect.void,
  // @ts-expect-error router-owned component data props are not supported
  component: ({ data }: { readonly data: { readonly count: number } }) => data.count
}
void badOptions

// A presentation-only options object cannot hide a gate behind its type.
const hiddenDirect = { component: () => null, prepare: () => Effect.fail("error") }
// @ts-expect-error presentation-only options cannot hide a direct gate
// oxlint-disable-next-line effecttsgo/missing-effect-error -- Negative assignment checks the gate's error channel.
const directPresentation: PresentationOptions<{}, {}, undefined> = hiddenDirect
void directPresentation
const hiddenFactory = { component: () => null, prepare: Effect.succeed(() => Effect.void) }
// @ts-expect-error presentation-only options cannot hide a gate factory
const factoryPresentation: PresentationOptions<{}, {}, undefined> = hiddenFactory
void factoryPresentation

// Destinations are typed by the application's selected membership.
const onlyHome = (props: { readonly to: Router.DestinationOf<readonly [typeof Home]> }): unknown => props.to
onlyHome({ to: Home.to() })
// @ts-expect-error a destination outside the selection is not a member
onlyHome({ to: Project.to({ params: { workspaceId, projectId } }) })

// useRouteInput preserves the definition's decoded input inference.
const projectInput = useRouteInput(Project)
const inferredProjectId: typeof projectId = projectInput.params.projectId
void inferredProjectId

// Headless definitions are a runtime, not a static, mismatch with native
// applications; the reverse is asserted at runtime.
void Router

// An index endpoint carries its own hash through destinations and hooks.
const HashParent = layout("hashParent", "/hash-parent", {})
const HashedIndex = HashParent.index({
  hash: Schema.String,
  prepare: () => Effect.void
})
const hashApp = make("HashApp", [HashedIndex])
void hashApp
const hashInput = useRouteInput(HashedIndex)
const hashValue: string = hashInput.hash
void hashValue
HashedIndex.to({ hash: "section" })
// @ts-expect-error the index hash destination requires its declared hash
HashedIndex.to({})

// --- typed path navigation ---
type AppDefs = readonly [typeof Home, typeof Project]
const pathToProject: LinkProps<AppDefs> = {
  to: "/workspaces/:workspaceId/projects/:projectId",
  params: { workspaceId, projectId }
}
void pathToProject
// @ts-expect-error an unknown path template is not a selected endpoint
const unknownPath: LinkProps<AppDefs> = { to: "/nope" }
void unknownPath
const missingParam: LinkProps<AppDefs> = {
  to: "/workspaces/:workspaceId/projects/:projectId",
  // @ts-expect-error an inherited required param cannot be omitted
  params: { workspaceId }
}
void missingParam
const wrongParam: LinkProps<AppDefs> = {
  to: "/workspaces/:workspaceId/projects/:projectId",
  // @ts-expect-error a param keeps its decoded branded type
  params: { workspaceId, projectId: "not-a-number" }
}
void wrongParam
// @ts-expect-error a layout path is not a navigable endpoint
const layoutPath: LinkProps<AppDefs> = { to: "/workspaces/:workspaceId" }
void layoutPath

// --- explicitly selected layout kind ---
// A selected layout contributes no navigable path.
const LayoutOnly = layout("layoutOnly", "/layout-only", {})
type LayoutOnlyPaths = Router.PathsOf<readonly [typeof LayoutOnly]>
// @ts-expect-error a selected layout is not a navigable endpoint
const layoutOnlyPath: LayoutOnlyPaths = "/layout-only"
void layoutOnlyPath

// A layout sharing its path with an index endpoint keeps the index's own
// required search fields instead of collapsing the union.
const SelectedLayout = layout("selected", "/selected", {
  search: { tab: Schema.String },
  component: () => null
})
const SelectedIndex = SelectedLayout.index({
  search: { page: Schema.FiniteFromString },
  prepare: () => Effect.void
})
type LayoutRoutes = readonly [typeof SelectedLayout, typeof SelectedIndex]
const page = Schema.decodeUnknownSync(Schema.FiniteFromString)("1")
const layoutIndexTarget: Router.PathTargets<LayoutRoutes> = {
  to: "/selected",
  search: { tab: "x", page }
}
void layoutIndexTarget
// @ts-expect-error the index's own search field is required at the shared path
const layoutIndexMissing: Router.PathTargets<LayoutRoutes> = { to: "/selected", search: { tab: "x" } }
void layoutIndexMissing

// --- Link props ---
// A typed link accepts replace/state options and a native anchor ref.
const linkRef = React.createRef<HTMLAnchorElement>()
const linkWithOptions: LinkProps<AppDefs> = {
  to: "/workspaces/:workspaceId/projects/:projectId",
  params: { workspaceId, projectId },
  replace: true,
  state: { from: "link" },
  ref: linkRef
}
void linkWithOptions
// @ts-expect-error a link ref is an anchor element, not an unrelated element
const linkWithWrongRef: LinkProps<AppDefs> = { to: "/", ref: React.createRef<HTMLButtonElement>() }
void linkWithWrongRef

// --- native broad/erased carriers are conservative ---
// Broad or erased definitions are accepted type-wise and report `unknown`
// requirements through the shared metadata projections (never a silent `{}`).
const widenedShape: Router.AnyDefinitionShape = Home
const widenedNativeApp = make("WidenedNative", [widenedShape])
declare const widenedNativeReq: Router.ApplicationRequirementsOf<typeof widenedNativeApp>
void widenedNativeReq
declare const annotatedTuple: readonly [Router.AnyDefinitionShape, Router.AnyDefinitionShape]
const annotatedNativeApp = make("AnnotatedTupleNative", annotatedTuple)
declare const annotatedNativeReq: Router.ApplicationRequirementsOf<typeof annotatedNativeApp>
void annotatedNativeReq
const erasedImpl: Pick<typeof Project, "_tag" | "id" | "path" | "~node"> = Project
const erasedNativeApp = make("ErasedImplNative", [erasedImpl])
declare const erasedNativeReq: Router.ApplicationRequirementsOf<typeof erasedNativeApp>
void erasedNativeReq
