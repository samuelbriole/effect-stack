/** Compile-time runtime-only mounting contract; not run by Vitest. */
import * as Layer from "effect/Layer"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Atom from "effect/reactivity/Atom"
import * as MemoryHistory from "@effect-stack/router/MemoryHistory"
import { make, route, layer, RouterProvider } from "@effect-stack/router-react"
import * as ReactRouter from "@effect-stack/router-react"

class Domain extends Context.Service<Domain, {}>()("check/ReactDomain") {}
const assembly = make("React", [
  route("home", "/", {
    component: () => null,
    prepare: () => Effect.asVoid(Domain)
  })
])
const app = Effect.runSync(assembly)
const services = Layer.merge(MemoryHistory.layer(), Layer.succeed(Domain, {}))
const live = layer(assembly).pipe(Layer.provideMerge(services))
const runtime = Atom.runtime(live)
const good = <RouterProvider runtime={runtime} />
const typedStartup = layer(Effect.andThen(Effect.fail("startup" as const), assembly)).pipe(Layer.provideMerge(services))
const startup = <RouterProvider runtime={Atom.runtime(typedStartup)} />

// @ts-expect-error Mounting requires the standard RuntimeApplication service.
const missing = <RouterProvider runtime={Atom.runtime(Layer.empty)} />
// @ts-expect-error The dynamic app service alone is not a mounting runtime.
const dynamicOnly = <RouterProvider runtime={Atom.runtime(app.layer.pipe(Layer.provide(services)))} />
// @ts-expect-error The runtime alone selects its application.
const legacyApp = <RouterProvider runtime={runtime} app={app} />
// @ts-expect-error Custom application selectors are not mounting inputs.
const legacySelector = <RouterProvider runtime={runtime} application={Domain} />
// @ts-expect-error The provider renders its application, not arbitrary children.
const children = <RouterProvider runtime={runtime}>ignored</RouterProvider>
// @ts-expect-error No compatibility export.
// oxlint-disable-next-line import/namespace -- Negative compile-time export check.
void ReactRouter.Provider
// @ts-expect-error No compatibility props export.
type Legacy = ReactRouter.ProviderProps<never, never, never>
void ({} as Legacy)
void [good, startup, missing, dynamicOnly, legacyApp, legacySelector, children]
