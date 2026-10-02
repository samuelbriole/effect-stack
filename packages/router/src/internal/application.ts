/**
 * Renderer-neutral application assembly and the scoped router service.
 * Internal module.
 *
 * Assembly derives the canonical node index, execution records, and renderer
 * presentation map directly from trusted selected definitions. There is one
 * construction path regardless of how the definitions were authored.
 *
 * @since 0.4.0
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import { compile } from "./compiler.ts"
import { collectSelection, type AnyNode, type AnyDefinitionShape, type DefinitionFactory } from "./definition.ts"
import type { Coordinator, RouteGate, Snapshot } from "./coordinator.ts"
import { make as makeCoordinator } from "./coordinator.ts"
import type { ApplicationServiceId, SelectionError, SelectionRequirements } from "./gates.ts"
import { CoreApplicationTypeId, applicationTypesBrand, ApplicationTypesTypeId } from "./gates.ts"
import { RouteDefinitionError } from "./errors.ts"
import type * as History from "../History.ts"
import type { ApplicationOf, CoreApplication, RouterService, RouterState } from "../Router.ts"
import { encodeDestination } from "./href.ts"

const ApplicationCounter = Symbol.for("@effect-stack/router/ApplicationCounter")
const globalRegistry = globalThis as unknown as Record<symbol, number | undefined>

/** Canonical runtime facts of an assembled application. @since 0.4.0 */
export interface ApplicationRuntime {
  readonly byId: ReadonlyMap<string, AnyNode>
  /** Selected endpoints indexed by their absolute path template. @since 0.4.0 */
  readonly byPath: ReadonlyMap<string, AnyNode>
  readonly factory: object
  readonly views: ReadonlyMap<string, unknown>
}

const runtimes = new WeakMap<object, ApplicationRuntime>()

/** Structural application identity without widening its invariant gate evidence. @since 0.4.0 */
export interface ApplicationWitness {
  readonly appId: string
  readonly routes: unknown
  readonly token: object
  readonly service: Context.Key<string, unknown>
}

/** One acquired application selected by a runtime's Layer composition. @since 0.4.0 */
export class RuntimeApplication extends Context.Service<
  RuntimeApplication,
  {
    readonly app: ApplicationWitness
    readonly router: RouterService
  }
>()("@effect-stack/router/RuntimeApplication") {}

/** Acquires one canonical application and publishes it with its scoped router. @since 0.4.0 */
export const applicationLayer = <Id extends string, Routes, GateE, GateR, E, R>(
  assembly: Effect.Effect<CoreApplication<Id, Routes, GateE, GateR>, E, R>
) =>
  Layer.unwrap(
    Effect.map(assembly, (app) => {
      if (applicationRuntime(app) === undefined) {
        throw new RouteDefinitionError({ message: "Router.layer requires an assembled application witness" })
      }
      // The canonical application's own Layer acquires this service; erase only its route/gate types.
      return Layer.effect(
        RuntimeApplication,
        Effect.map(app.service, (router) => ({ app, router: router as RouterService }))
      ).pipe(Layer.provide(app.layer))
    })
  )

/** Reads the canonical runtime facts of an assembled application. @since 0.4.0 */
export const applicationRuntime = (value: unknown): ApplicationRuntime | undefined =>
  typeof value === "object" && value !== null ? runtimes.get(value) : undefined

const toPublicState =
  <Routes>(routes: Routes) =>
  (snapshot: Snapshot): RouterState<Routes> => ({
    location: snapshot.location,
    status: snapshot.status,
    presentation: snapshot.presentation,
    resolved: snapshot.resolved,
    routes
  })

const makeService = <Routes>(
  routes: Routes,
  coordinator: Coordinator,
  compiled: ReturnType<typeof compile>,
  applicationId: string,
  token: object
): RouterService<Routes> => ({
  applicationId,
  routes,
  token,
  awaitInitial: coordinator.awaitInitial,
  state: SubscriptionRef.get(coordinator.snapshot).pipe(Effect.map(toPublicState(routes))),
  changes: SubscriptionRef.changes(coordinator.snapshot).pipe(Stream.map(toPublicState(routes))),
  navigate: coordinator.navigate,
  submit: coordinator.submit,
  refresh: coordinator.refresh,
  retry: coordinator.retry,
  back: coordinator.back,
  forward: coordinator.forward,
  go: coordinator.go,
  href: (destination) => encodeDestination(destination, compiled.byId)
})

/**
 * Lazily selects definitions and assembles a fresh application. Invalid
 * definitions fail execution with a defect; runtime resources belong to its Layer.
 *
 * @since 0.4.0
 */
export const makeApplication = Effect.fn("Router.make")(function* <
  const AppId extends string,
  const Defs extends readonly [AnyDefinitionShape, ...Array<AnyDefinitionShape>],
  Presentation
>(appId: AppId, routes: Defs, factory: DefinitionFactory<Presentation>): Effect.fn.Return<ApplicationOf<AppId, Defs>> {
  type E = SelectionError<Defs>
  type R = SelectionRequirements<Defs>
  if (appId.length === 0)
    return yield* Effect.die(new RouteDefinitionError({ message: "Application id must not be empty" }))
  if (appId.includes(".") || appId.includes("/")) {
    return yield* Effect.die(
      new RouteDefinitionError({ message: `Application id "${appId}" must not contain "." or "/"` })
    )
  }
  if (routes.length === 0)
    return yield* Effect.die(new RouteDefinitionError({ message: "Router.make requires at least one definition" }))
  const { nodes, inputs, presentations } = collectSelection(routes, factory)
  const compiled = compile(nodes)
  const nonce = (globalRegistry[ApplicationCounter] ?? 0) + 1
  globalRegistry[ApplicationCounter] = nonce

  const token = {}
  const serviceKey = Context.Service<ApplicationServiceId<AppId, E, R>, RouterService<Defs, E>>(
    `@effect-stack/router/${appId}/service#${nonce}`
  )
  const build = Effect.gen(function* () {
    const context = Context.omit(Scope.Scope)(yield* Effect.context<never>())
    const gates = new Map<string, RouteGate>()
    for (const input of inputs) {
      const prepare = input.prepare as (input: unknown) => Effect.Effect<void, unknown, Scope.Scope>
      gates.set(input.node.id, {
        node: input.node,
        run: (value) => Effect.suspend(() => prepare(value)).pipe(Effect.provide(context))
      })
    }
    const coordinator = yield* makeCoordinator(compiled, gates)
    // Restore the selection's gate evidence at the public application seam.
    return makeService(routes, coordinator, compiled, appId, token) as RouterService<Defs, E>
  })
  const layer = Layer.effect(serviceKey, build) as Layer.Layer<
    ApplicationServiceId<AppId, E, R>,
    History.HistoryError,
    R | History.History
  >

  const value = {
    [CoreApplicationTypeId]: true as const,
    appId,
    routes,
    [ApplicationTypesTypeId]: applicationTypesBrand<E, R>,
    token,
    service: serviceKey,
    layer
  }
  runtimes.set(value, {
    byId: compiled.byId,
    byPath: new Map(nodes.filter((node) => node._tag === "RouteDescriptor").map((node) => [node.path, node])),
    factory,
    views: presentations
  })
  return value
})
