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
import * as Result from "effect/Result"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import { compile } from "./compiler.ts"
import type { AnyNode } from "./definition.ts"
import type { Coordinator, NavigationOutcome, RouteGate, Snapshot } from "./coordinator.ts"
import { make as makeCoordinator } from "./coordinator.ts"
import type { ApplicationServiceId, GateDefinitionInput } from "./gates.ts"
import { CoreApplicationTypeId, applicationTypesBrand, ApplicationTypesTypeId } from "./gates.ts"
import { RouteDefinitionError } from "./errors.ts"
import * as History from "../History.ts"
import type { CoreApplication, NavigationError, NavigationHandle, RouterService, RouterState } from "../Router.ts"
import { encodeDestination } from "./href.ts"
import { resolveNavigationTarget } from "./destinations.ts"
import { registerDetachedCommands } from "./commands.ts"

const captureContext = Effect.gen(function* () {
  const context = yield* Effect.context<never>()
  return Context.omit(Scope.Scope)(context)
})

const ApplicationCounter = Symbol.for("@effect-stack/router/ApplicationCounter")
const globalRegistry = globalThis as unknown as Record<symbol, number | undefined>
const nextApplicationNonce = (): number => {
  const next = (globalRegistry[ApplicationCounter] ?? 0) + 1
  globalRegistry[ApplicationCounter] = next
  return next
}

/** Canonical runtime facts of an assembled application. @since 0.4.0 */
export interface ApplicationRuntime {
  readonly nodes: ReadonlyArray<AnyNode>
  readonly byId: ReadonlyMap<string, AnyNode>
  /** Selected endpoints indexed by their absolute path template. @since 0.4.0 */
  readonly byPath: ReadonlyMap<string, AnyNode>
  readonly presentationFactory?: object
  readonly views?: ReadonlyMap<string, unknown>
}

const runtimes = new WeakMap<object, ApplicationRuntime>()

/** Reads the canonical runtime facts of an assembled application. @since 0.4.0 */
export const applicationRuntime = (value: unknown): ApplicationRuntime | undefined =>
  typeof value === "object" && value !== null ? runtimes.get(value) : undefined

const endpointPathIndex = (nodes: ReadonlyArray<AnyNode>): ReadonlyMap<string, AnyNode> => {
  const byPath = new Map<string, AnyNode>()
  for (const node of nodes) {
    if (node._tag !== "RouteDescriptor") continue
    if (!byPath.has(node.path)) byPath.set(node.path, node)
  }
  return byPath
}

const toPublicState =
  <Routes>(routes: Routes) =>
  (snapshot: Snapshot): RouterState<Routes> => ({
    location: snapshot.location,
    status: snapshot.status,
    presentation: snapshot.presentation,
    resolved: snapshot.resolved,
    routes
  })

const makeService = <Routes, E>(
  routes: Routes,
  coordinator: Coordinator,
  compiled: ReturnType<typeof compile>,
  applicationId: string,
  token: object
): RouterService<Routes, E> => ({
  applicationId,
  routes,
  token,
  // oxlint-disable-next-line effecttsgo/unsafe-effect-type-assertion -- Internal errors are erased; the public contract declares the union.
  awaitInitial: coordinator.awaitInitial as Effect.Effect<void, NavigationError<E>>,
  state: SubscriptionRef.get(coordinator.snapshot).pipe(Effect.map(toPublicState(routes))),
  changes: SubscriptionRef.changes(coordinator.snapshot).pipe(Stream.map(toPublicState(routes))),
  navigate: (destination, options) =>
    // oxlint-disable-next-line effecttsgo/unsafe-effect-type-assertion -- Internal errors are erased; the public contract declares the union.
    coordinator.navigate(destination, options) as Effect.Effect<NavigationOutcome, NavigationError<E>>,
  submit: (destination, options) => {
    const handleEffect = coordinator.submit(destination, options).pipe(
      Effect.map((handle): NavigationHandle<E> => ({
        id: handle.id,
        // oxlint-disable-next-line effecttsgo/unsafe-effect-type-assertion -- Internal errors are erased; the public contract declares the union.
        await: handle.await as Effect.Effect<NavigationOutcome, NavigationError<E>>,
        cancel: handle.cancel
      }))
    )
    // oxlint-disable-next-line effecttsgo/unsafe-effect-type-assertion -- Internal errors are erased; the public contract declares the union.
    return handleEffect as Effect.Effect<NavigationHandle<E>, NavigationError<E>>
  },
  // oxlint-disable-next-line effecttsgo/unsafe-effect-type-assertion -- Internal errors are erased; the public contract declares the union.
  refresh: coordinator.refresh as Effect.Effect<NavigationOutcome, NavigationError<E>>,
  // oxlint-disable-next-line effecttsgo/unsafe-effect-type-assertion -- Internal errors are erased; the public contract declares the union.
  retry: coordinator.retry as Effect.Effect<NavigationOutcome, NavigationError<E>>,
  back: coordinator.back,
  forward: coordinator.forward,
  go: coordinator.go,
  href: (destination) => encodeDestination(destination, compiled.byId)
})

/**
 * Builds one executable application from canonical nodes and validated gate
 * inputs.
 *
 * @since 0.4.0
 */
export const makeApplication = <AppId extends string, Routes, E, R>(
  appId: AppId,
  routes: Routes,
  nodes: ReadonlyArray<AnyNode>,
  inputs: ReadonlyArray<GateDefinitionInput>,
  presentation?: { readonly factory: object; readonly views: ReadonlyMap<string, unknown> }
): CoreApplication<AppId, Routes, E, R> => {
  const compiled = compile(nodes)
  const byId = compiled.byId
  const nonce = nextApplicationNonce()
  const seen = new Set<string>()
  for (const input of inputs) {
    const node = byId.get(input.node.id)
    if (node === undefined || node !== input.node) {
      throw new RouteDefinitionError({
        message: `Gate "${input.node.id}" does not target a canonical node of this selection`
      })
    }
    if (seen.has(input.node.id)) {
      throw new RouteDefinitionError({ message: `Duplicate gate for route "${input.node.id}"` })
    }
    seen.add(input.node.id)
  }

  const token = {}
  const serviceKey = Context.Service<ApplicationServiceId<AppId, E, R>, RouterService<Routes, E>>(
    `@effect-stack/router/${appId}/service#${nonce}`
  )
  const build = Effect.gen(function* () {
    yield* History.History
    const context = yield* captureContext
    const gates = new Map<string, RouteGate>()
    for (const input of inputs) {
      const prepare = input.prepare as (input: unknown) => Effect.Effect<void, unknown, Scope.Scope>
      gates.set(input.node.id, {
        node: input.node,
        run: (value) => Effect.suspend(() => prepare(value)).pipe(Effect.provide(context))
      })
    }
    const coordinator = yield* makeCoordinator(compiled, gates, appId)
    const router = makeService<Routes, E>(routes, coordinator, compiled, appId, token)
    const runFork = Effect.runForkWith(context)
    registerDetachedCommands(router, {
      navigate: (target, options) => {
        const destination = Effect.suspend(() => {
          const resolved = resolveNavigationTarget(value, target)
          return Result.isFailure(resolved) ? Effect.fail(resolved.failure) : Effect.succeed(resolved.success)
        })
        runFork(coordinator.navigateDetached(destination, options))
      },
      retry: () => {
        runFork(coordinator.retryDetached)
      }
    })
    return router
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
    nodes,
    byId: byId as ReadonlyMap<string, AnyNode>,
    byPath: endpointPathIndex(nodes),
    ...(presentation === undefined ? {} : { presentationFactory: presentation.factory, views: presentation.views })
  })
  return value
}
