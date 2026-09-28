/**
 * Supported construction bridge for first-party and third-party renderer
 * adapters.
 *
 * The bridge owns one neutral definition engine. An adapter supplies a
 * renderer name for diagnostics, a presentation normalizer, and an
 * explicit-empty check; native contextual options, Providers, bound components
 * and hooks, and renderer lifecycles stay in the adapter. This is not a generic
 * UI runtime: the bridge never calls components, subscribes, or runs lifecycle
 * callbacks.
 *
 * One engine backs both top-level and nested constructors, so there are not
 * three separate constructor implementations. Type-level convenience wrappers
 * live in each adapter; the runtime here only builds trusted objects. Trusted
 * definition records stay private to the core: the bridge exposes construction
 * and finalization only, never the trusted WeakMap payload. The engine's factory
 * is its ownership capability; adapters must retain it rather than copy it.
 *
 * @since 0.4.0
 */
import {
  collectSelection,
  defineLayout,
  defineRoute,
  type AnyDefinitionShape,
  type DefinitionFactory
} from "./internal/definition.ts"
import { applicationRuntime, makeApplication } from "./internal/application.ts"
import type { ApplicationOf } from "./Router.ts"
import type { SelectionError, SelectionRequirements } from "./internal/gates.ts"
import { RouteDefinitionError } from "./internal/errors.ts"
export { resolveNavigationTarget } from "./internal/destinations.ts"

/** The renderer-specific facts a `makeDefinitionEngine` call needs. @since 0.4.0 */
export interface AdapterSpec<Presentation> {
  /** A human-readable renderer name used only in diagnostics. @since 0.4.0 */
  readonly renderer: string
  /** Normalizes native options into an opaque presentation snapshot. @since 0.4.0 */
  readonly normalize: (options: unknown) => Presentation
  /** Whether a snapshot carries no presentation. @since 0.4.0 */
  readonly isEmpty: (presentation: Presentation) => boolean
}

/**
 * A neutral definition engine for one renderer. Every method creates a
 * constructor-owned definition; nested construction reuses the same
 * presentation factory.
 *
 * @since 0.4.0
 * @category models
 */
export interface DefinitionEngine<Presentation> {
  readonly factory: DefinitionFactory<Presentation>
  readonly route: (parent: object | undefined, name: string, path: string, options: unknown) => object
  readonly layout: (parent: object | undefined, name: string, path: string, options: unknown) => object
  readonly index: (parent: object, options: unknown) => object
}

/**
 * Creates the supported renderer engine. Every call creates a fresh factory
 * ownership capability, so same-named adapters stay isolated.
 *
 * @since 0.4.0
 * @category constructors
 */
export const makeDefinitionEngine = <Presentation>(spec: AdapterSpec<Presentation>): DefinitionEngine<Presentation> => {
  const factory: DefinitionFactory<Presentation> = {
    renderer: spec.renderer,
    requiresPresentation: true,
    normalize: spec.normalize,
    isEmpty: spec.isEmpty
  }
  return {
    factory,
    route: (parent, name, path, options) => defineRoute(factory, parent, name, path, options),
    layout: (parent, name, path, options) => defineLayout(factory, parent, name, path, options),
    index: (parent, options) => defineRoute(factory, parent, "index", "/", options)
  }
}

/**
 * Finalizes a native application from an inline selection of definitions:
 * validates endpoint coverage and renderer ownership, derives the canonical
 * nodes, and assembles the core application and presentation map.
 *
 * Aggregate E/R follows `Router.make`: erased or widened evidence reports
 * unknown errors and requirements, never an empty/free specification. Runtime
 * validation checks constructor identity and ownership, not phantom E/R types.
 *
 * @since 0.4.0
 * @category constructors
 */
export const finishApplication = <
  Defs extends readonly [AnyDefinitionShape, ...Array<AnyDefinitionShape>],
  Presentation,
  AppId extends string
>(
  engine: DefinitionEngine<Presentation>,
  appId: AppId,
  definitions: Defs
): ApplicationOf<AppId, Defs> => {
  const selection = collectSelection(
    definitions,
    engine.factory.requiresPresentation,
    engine.factory.isEmpty as (presentation: unknown) => boolean,
    engine.factory
  )
  return makeApplication<AppId, Defs, SelectionError<Defs>, SelectionRequirements<Defs>>(
    appId,
    definitions,
    selection.nodes,
    selection.inputs,
    { factory: engine.factory, views: selection.presentations }
  )
}

/** Reads native presentation registered by this exact engine. @since 0.4.0 */
export const getApplicationViews = <Presentation>(
  engine: DefinitionEngine<Presentation>,
  app: unknown
): ReadonlyMap<string, Presentation> => {
  const runtime = applicationRuntime(app)
  if (runtime?.views === undefined || runtime.presentationFactory !== engine.factory) {
    throw new RouteDefinitionError({ message: "Application does not belong to this presentation engine" })
  }
  // Assembly stores only presentations normalized by this exact factory.
  return runtime.views as ReadonlyMap<string, Presentation>
}
