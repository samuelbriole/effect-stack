/**
 * Unified native route definitions: identity, URL schemas, gates, renderer
 * ownership, and assembly. Internal module.
 *
 * A definition is already a typed route reference. It owns its effective path,
 * inherited decoded input, optional direct gate, and an opaque renderer
 * presentation. Parent-aware constructors (`parent.route`, `parent.layout`,
 * `parent.index`) establish the parent before contextually typing child
 * options, so a standalone child never infers schemas from a parent attached
 * later.
 *
 * Trusted facts live in a private `WeakMap` keyed by the exact constructor
 * output. Copied or spread values, and values fabricated from readable fields,
 * are never found; renderer ownership is a private capability, not a string.
 *
 * @since 0.4.0
 */
import * as Schema from "effect/Schema"
import { RouteDefinitionError } from "./errors.ts"
import type { GateTypes } from "./gates.ts"
import type { RedirectSignal } from "./redirect.ts"
import type { UrlCodec, UrlFields, UrlSchema, UrlSchemaFields } from "./url.ts"

export type { UrlCodec, UrlFields, UrlSchema, UrlSchemaFields } from "./url.ts"

/** Struct field map accepted for URL sections. @since 0.4.0 */
export type Fields = Schema.Struct.Fields

/** The decoded value of a struct field map. @since 0.4.0 */
export type StructType<F extends Fields> = Schema.Struct<F>["Type"]

/** The decoded value of an optional hash schema. @since 0.4.0 */
export type HashType<H extends Schema.Top | undefined> = H extends Schema.Top ? H["Type"] : undefined

/** A child hash overrides its parent schema; absence inherits it. @since 0.4.0 */
export type InheritedHash<
  Parent extends Schema.Top | undefined,
  Own extends Schema.Top | undefined
> = Own extends undefined ? Parent : Own

/** The static kind of a definition node. @since 0.4.0 */
export type DefinitionKind = "endpoint" | "layout"

/**
 * The decoded URL identity and inheritance chain of one definition. `kind`
 * discriminates endpoints from layouts statically, so
 * navigation never has to infer it from a name heuristic.
 *
 * @since 0.4.0
 * @category models
 */
export interface NodeInfo<
  Id extends string = string,
  Path extends string = string,
  Params extends Fields = Fields,
  Search extends Fields = Fields,
  Hash extends Schema.Top | undefined = Schema.Top | undefined,
  Kind extends DefinitionKind = "endpoint"
> {
  readonly id: Id
  readonly path: Path
  readonly params: Params
  readonly search: Search
  readonly hash: Hash
  readonly kind: Kind
}

/** A node info whose kind is widened. @since 0.4.0 */
export type AnyNodeInfo = NodeInfo<string, string, Fields, Fields, Schema.Top | undefined, DefinitionKind>

/** @since 0.4.0 */
export type ParamsOf<I extends AnyNodeInfo> = StructType<I["params"]>
/** @since 0.4.0 */
export type SearchOf<I extends AnyNodeInfo> = StructType<I["search"]>
/** @since 0.4.0 */
export type HashOf<I extends AnyNodeInfo> = HashType<I["hash"]>

/** The type-level info carried by a definition. @since 0.4.0 */
export type InfoOf<D> = D extends { readonly "~node": infer I extends AnyNodeInfo } ? I : never
/** The canonical qualified id of a definition. @since 0.4.0 */
export type IdOf<D> = InfoOf<D>["id"]
/** The decoded params of a definition. @since 0.4.0 */
export type ParamsOfDef<D> = ParamsOf<InfoOf<D>>
/** The decoded search of a definition. @since 0.4.0 */
export type SearchOfDef<D> = SearchOf<InfoOf<D>>
/** The decoded hash of a definition. @since 0.4.0 */
export type HashOfDef<D> = HashOf<InfoOf<D>>
/** The destination input of a definition. @since 0.4.0 */
export type InputOfDef<D> = InputOf<InfoOf<D>>

type Section<K extends string, Value> = {} extends Value ? { readonly [P in K]?: Value } : { readonly [P in K]: Value }

/**
 * The effective decoded destination input for one node. A section is omitted
 * when the node declares no fields, and optional when its decoded type can be
 * empty.
 *
 * @since 0.4.0
 * @category type utilities
 */
export type InputOf<I extends AnyNodeInfo> = ([keyof I["params"]] extends [never]
  ? {}
  : Section<"params", StructType<I["params"]>>)
  & ([keyof I["search"]] extends [never] ? {} : Section<"search", StructType<I["search"]>>)
  & (I["hash"] extends Schema.Top ? Section<"hash", HashType<I["hash"]>> : {})

/**
 * The decoded input supplied to a gate. Unlike destination input, every
 * section is present: an undeclared section decodes to its empty value.
 *
 * @since 0.4.0
 * @category models
 */
export interface DecodedRouteInput<
  Params extends Fields = Fields,
  Search extends Fields = Fields,
  Hash extends Schema.Top | undefined = undefined
> {
  readonly params: StructType<Params>
  readonly search: StructType<Search>
  readonly hash: HashType<Hash>
  readonly location: {
    readonly pathname: string
    readonly search: string
    readonly hash: string
  }
}

/** @since 0.4.0 */
export type DecodedRouteInputOf<I extends AnyNodeInfo> = DecodedRouteInput<I["params"], I["search"], I["hash"]>

/** The decoded gate input of a definition. @since 0.4.0 */
export type DecodedRouteInputOfDef<D> = DecodedRouteInput<InfoOf<D>["params"], InfoOf<D>["search"], InfoOf<D>["hash"]>

// --- runtime node surface ---

/** Runtime node surface shared by route and layout definitions. @since 0.4.0 */
export interface RuntimeNode {
  readonly _tag: "RouteDescriptor" | "GroupDescriptor"
  readonly id: string
  readonly path: string
  readonly parentId: string | undefined
  readonly kind: "route" | "layout"
  readonly paramsSchema: Schema.Struct<UrlFields>
  readonly searchSchema: Schema.Struct<UrlFields>
  readonly hashSchema: UrlCodec | undefined
}

/** Runtime route node. @since 0.4.0 */
export interface RuntimeRouteNode extends RuntimeNode {
  readonly _tag: "RouteDescriptor"
}

/** Runtime layout node. @since 0.4.0 */
export interface RuntimeLayoutNode extends RuntimeNode {
  readonly _tag: "GroupDescriptor"
}

/** A runtime node of either kind. @since 0.4.0 */
export type AnyNode = RuntimeNode

// --- destinations ---

/** @since 0.4.0 */
export interface DestinationOptions {
  readonly replace?: boolean
  readonly state?: unknown
}

/**
 * A constructed destination. The definition's `.to` call already validated its
 * input shape; navigation encodes it and validates canonical membership at
 * runtime.
 *
 * @since 0.4.0
 * @category models
 */
export interface Destination<Brand = unknown> {
  readonly _tag: "@effect-stack/router/Destination"
  readonly node: AnyNode
  readonly input: unknown
  readonly replace: boolean
  readonly state: unknown
  readonly "~brand"?: Brand
}

/** The destination brand of a node. @since 0.4.0 */
export type DestinationBrand<I extends AnyNodeInfo> = I

/**
 * The union of destinations accepted by an application over its selected
 * definitions. Each definition contributes its own brand, which already
 * includes its ancestor closure.
 *
 * @since 0.4.0
 * @category type utilities
 */
export type DestinationOf<Routes> = Routes extends readonly unknown[]
  ? Routes[number] extends infer Def
    ? Def extends { readonly "~node": infer I extends AnyNodeInfo }
      ? Destination<DestinationBrand<I>>
      : never
    : never
  : Routes extends { readonly "~node": infer I extends AnyNodeInfo }
    ? Destination<DestinationBrand<I>>
    : Destination<unknown>

type DestinationCall<I extends AnyNodeInfo> =
  InputOf<I> extends infer Input
    ? {} extends Input
      ? {
          readonly to: (input?: Input, options?: DestinationOptions) => Destination<DestinationBrand<I>>
        }
      : {
          readonly to: (input: Input, options?: DestinationOptions) => Destination<DestinationBrand<I>>
        }
    : never

// --- public definition types ---

/** Type brand for unified route definitions. @since 0.4.0 */
export const RouteDefinitionTypeId: unique symbol = Symbol.for("@effect-stack/router/RouteDefinition")

/** Type brand for unified layout definitions. @since 0.4.0 */
export const LayoutDefinitionTypeId: unique symbol = Symbol.for("@effect-stack/router/LayoutDefinition")

/**
 * A unified endpoint definition: URL identity, decoded input, optional direct
 * `prepare` gate, and optional renderer presentation. `~gate` carries the
 * inferred gate metadata; the invariant brand prevents a definition from
 * claiming an unrelated specification. There is no prepared success value.
 *
 * @since 0.4.0
 * @category models
 */
export type RouteDefinition<Node extends AnyNodeInfo = AnyNodeInfo, Parent = undefined, E = never, R = never> = {
  readonly [RouteDefinitionTypeId]: (gate: GateTypes<E, R>) => GateTypes<E, R>
  readonly _tag: "RouteDescriptor"
  readonly id: Node["id"]
  readonly path: Node["path"]
  readonly "~node": Node
  readonly "~parent": Parent
  readonly "~gate": GateTypes<E, R>
} & DestinationCall<Node>

/** @since 0.4.0 */
export type AnyRouteDefinition = RouteDefinition<AnyNodeInfo, unknown, unknown, unknown>

/**
 * A unified layout definition: an endpoint-like definition that may omit
 * presentation and continues transparently to descendants.
 *
 * @since 0.4.0
 * @category models
 */
export type LayoutDefinition<
  Node extends AnyNodeInfo = AnyNodeInfo,
  Parent = undefined,
  E = never,
  R = never
> = RouteDefinition<Node, Parent, E, R> & {
  readonly [LayoutDefinitionTypeId]: (gate: GateTypes<E, R>) => GateTypes<E, R>
}

/** @since 0.4.0 */
export type AnyLayoutDefinition = LayoutDefinition<AnyNodeInfo, unknown, unknown, unknown>

/** @since 0.4.0 */
export type AnyDefinition = AnyDefinitionShape

/**
 * A structural supertype accepted by assembly selection. Concrete definitions
 * carry the invariant gate metadata brand; this loose shape keeps a
 * heterogeneous readonly tuple assignable while preserving each element's
 * exact type for inference.
 *
 * @since 0.4.0
 * @category models
 */
export interface AnyDefinitionShape {
  readonly "~node": AnyNodeInfo
  readonly _tag: "RouteDescriptor" | "GroupDescriptor"
  readonly id: string
  readonly path: string
  readonly "~parent"?: unknown
  readonly "~gate"?: unknown
}

// --- path and identity type helpers ---

/** @since 0.4.0 */
export type JoinPath<Parent extends string, Child extends string> = Child extends "" | "/"
  ? Parent extends ""
    ? "/"
    : Parent
  : Parent extends "" | "/"
    ? Child
    : `${Parent}${Child}`

/** @since 0.4.0 */
export type Qualify<ParentId extends string, Id extends string> = ParentId extends "" ? Id : `${ParentId}.${Id}`

/** The info of a nested definition under a known parent. @since 0.4.0 */
export type ChildInfo<
  Parent,
  Name extends string,
  Path extends string,
  Params extends Fields,
  Search extends Fields,
  Hash extends Schema.Top | undefined,
  Kind extends DefinitionKind = "endpoint"
> = Parent extends { readonly "~node": infer ParentNode extends AnyNodeInfo }
  ? NodeInfo<
      Qualify<ParentNode["id"], Name>,
      JoinPath<ParentNode["path"], Path>,
      ParentNode["params"] & Params,
      ParentNode["search"] & Search,
      InheritedHash<ParentNode["hash"], Hash>,
      Kind
    >
  : never

/** The info of an index endpoint at a parent's path. @since 0.4.0 */
export type IndexInfo<Parent, Search extends Fields = {}, Hash extends Schema.Top | undefined = undefined> = ChildInfo<
  Parent,
  "index",
  "/",
  {},
  Search,
  Hash
>

// --- typed path navigation projections ---

/** The endpoint info carried by a definition, or `never` for a layout. @since 0.4.0 */
export type EndpointInfo<Def> = Def extends { readonly "~node": infer I extends AnyNodeInfo }
  ? I["kind"] extends "layout"
    ? never
    : I
  : never

/** Every endpoint info selected by a readonly definitions tuple. @since 0.4.0 */
export type SelectedEndpoints<Defs> = Defs extends readonly unknown[] ? EndpointInfo<Defs[number]> : never

/** Every navigable endpoint path template of a selection. @since 0.4.0 */
export type PathsOf<Defs> = SelectedEndpoints<Defs>["path"]

/** The single endpoint info of a selection at one absolute path template. @since 0.4.0 */
export type EndpointAt<Defs, Path extends string> = Extract<SelectedEndpoints<Defs>, { readonly path: Path }>

/**
 * The correlated decoded input for a selected path template. Params, search,
 * and hash keep the existing required/optional rules and decoded schema types.
 * The conditional distributes over a union of template literals so each target
 * is correlated to its own endpoint rather than collapsing union keys.
 *
 * @since 0.4.0
 * @category type utilities
 */
export type PathInput<Defs, Path extends string> = Path extends unknown ? InputOf<EndpointAt<Defs, Path>> : never

/**
 * A typed path navigation target: `to` is a selected endpoint's absolute path
 * template, and params/search/hash are correlated to it with the existing
 * decoded schema types.
 *
 * @since 0.4.0
 * @category models
 */
export type PathTarget<Routes, Path extends PathsOf<Routes>> = Path extends unknown
  ? { readonly to: Path } & PathInput<Routes, Path>
  : never

/** The discriminated union of every path target of a selection. @since 0.4.0 */
export type PathTargets<Routes> = { [P in PathsOf<Routes>]: PathTarget<Routes, P> }[PathsOf<Routes>]

/** The target accepted by imperative navigation. @since 0.4.0 */
export type NavigateTarget<Routes> = DestinationOf<Routes> | PathTargets<Routes>

/** @since 0.4.0 */
export type { RedirectSignal }

/**
 * The renderer-neutral definition factory. Native adapters supply a
 * presentation normalizer and an explicit-empty check; the headless core uses
 * a no-op normalizer and never requires presentation. One factory family owns
 * both top-level and nested construction, so there is a single engine.
 *
 * @since 0.4.0
 * @category models
 */
export interface DefinitionFactory<Presentation = unknown> {
  /** A human-readable renderer name used only in diagnostics. @since 0.4.0 */
  readonly renderer: string
  /** Whether an endpoint requires an explicit presentation or `empty: true`. @since 0.4.0 */
  readonly requiresPresentation: boolean
  /** Normalizes native options into an opaque presentation snapshot. @since 0.4.0 */
  readonly normalize: (options: unknown) => Presentation
  /** Whether a snapshot carries no presentation. @since 0.4.0 */
  readonly isEmpty: (presentation: Presentation) => boolean
}

// --- private trusted store ---

/** One trusted definition record. @since 0.4.0 */
export interface TrustedDefinition<Presentation = unknown> {
  readonly node: AnyNode
  readonly parent: object | undefined
  readonly prepare: unknown
  readonly presentation: Presentation | undefined
  readonly empty: boolean
  readonly owner: object
}

const records = new WeakMap<object, TrustedDefinition>()

const isObjectLike = (value: unknown): value is object =>
  (typeof value === "object" && value !== null) || typeof value === "function"

/** Reads the private trusted record of a definition, or `undefined`. @since 0.4.0 */
export const trustedDefinition = (value: unknown): TrustedDefinition | undefined =>
  isObjectLike(value) ? records.get(value) : undefined

// --- validation ---

const definitionError = (message: string): RouteDefinitionError => new RouteDefinitionError({ message })

const reservedNames = new Set([
  "_tag",
  "id",
  "path",
  "parentId",
  "kind",
  "children",
  "paramsSchema",
  "searchSchema",
  "hashSchema",
  "service",
  "to",
  "route",
  "layout",
  "add",
  "pipe",
  "prefix",
  "identifier",
  "params",
  "search",
  "hash",
  "options",
  "state",
  "replace",
  "then",
  "__proto__",
  "constructor",
  "prototype",
  "toString",
  "valueOf",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "toLocaleString",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
  "~node",
  "~gate",
  "~parent"
])

const validateIdentifier = (identifier: string): void => {
  if (identifier.length === 0) throw definitionError("Route and layout names must not be empty")
  if (identifier.includes(".")) {
    throw definitionError(`Route or layout name "${identifier}" must not contain "."`)
  }
  if (identifier.includes("/")) {
    throw definitionError(`Route or layout name "${identifier}" must not contain "/"`)
  }
  if (reservedNames.has(identifier)) {
    throw definitionError(`Route or layout name "${identifier}" is reserved`)
  }
}

const pathSegments = (path: string): ReadonlyArray<string> => (path === "/" ? [] : path.slice(1).split("/"))

const parameterNames = (path: string): ReadonlyArray<string> =>
  pathSegments(path)
    .filter((segment) => segment.startsWith(":"))
    .map((segment) => segment.slice(1))

const validatePath = (id: string, path: string): void => {
  if (!path.startsWith("/")) throw definitionError(`Route "${id}" path must start with /`)
  if (path !== "/" && path.endsWith("/")) throw definitionError(`Route "${id}" path must not end with /`)
  if (path.includes("//")) throw definitionError(`Route "${id}" path must not contain repeated separators`)
  if (path.includes("?") || path.includes("#")) {
    throw definitionError(`Route "${id}" path must not contain query or fragment delimiters`)
  }
  const segments = pathSegments(path)
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw definitionError(`Route "${id}" path must not contain . or .. segments`)
  }
  const names = parameterNames(path)
  const seen = new Set<string>()
  for (const name of names) {
    if (seen.has(name)) throw definitionError(`Route "${id}" path repeats parameter :${name}`)
    seen.add(name)
  }
}

const validateRouteParameters = (id: string, params: Fields, path: string): void => {
  const expected = [...parameterNames(path)].sort()
  const actual = Object.keys(params).sort()
  if (expected.length !== actual.length || expected.some((parameter, index) => parameter !== actual[index])) {
    throw definitionError(
      `Route "${id}" path parameters (${expected.join(", ")}) do not match params fields (${actual.join(", ")})`
    )
  }
}

const mergeFields = (kind: "params" | "search", id: string, inherited: Fields, own: Fields): Fields => {
  for (const key of Object.keys(own)) {
    if (Object.prototype.hasOwnProperty.call(inherited, key)) {
      throw definitionError(`Route "${id}" redeclares inherited ${kind} field "${key}"`)
    }
  }
  return Object.freeze({ ...inherited, ...own })
}

const snapshotFields = (fields: Fields | undefined): Fields => (fields === undefined ? {} : { ...fields })

const structSchema = (fields: Fields): Schema.Struct<UrlFields> =>
  Schema.Struct(fields) as unknown as Schema.Struct<UrlFields>

const joinPath = (parentPath: string, child: string): string => {
  if (child === "" || child === "/") return parentPath === "" ? "/" : parentPath
  if (parentPath === "" || parentPath === "/") return child
  return `${parentPath}${child}`
}

// --- construction ---

interface BuildOptions {
  readonly params?: UrlSchemaFields
  readonly search?: UrlSchemaFields
  readonly hash?: UrlSchema
  readonly prepare?: unknown
  readonly empty?: boolean
}

/** Builds an identity destination for one canonical node and input. @since 0.4.0 */
export const makeDestination = (
  node: AnyNode,
  input: unknown,
  options: DestinationOptions | undefined
): Destination => {
  const candidate = (input ?? {}) as { readonly params?: unknown; readonly search?: unknown; readonly hash?: unknown }
  return {
    _tag: "@effect-stack/router/Destination",
    node,
    input: {
      params: candidate.params ?? {},
      search: candidate.search ?? {},
      hash: candidate.hash
    },
    replace: options?.replace ?? false,
    state: options?.state
  }
}

interface BuildContext {
  readonly kind: "route" | "layout"
  readonly parent: object | undefined
  readonly parentNode: AnyNode | undefined
  readonly name: string
  readonly localPath: string
}

const buildNode = (context: BuildContext, options: BuildOptions): AnyNode => {
  const { parent, parentNode, name, localPath, kind } = context
  validateIdentifier(name)
  if (parent === undefined && parentNode !== undefined) {
    throw definitionError(`Definition "${name}" has an inconsistent parent`)
  }
  if (parent !== undefined && trustedDefinition(parent)?.node.kind !== "layout") {
    throw definitionError(`Definition "${name}" requires a layout parent`)
  }
  if (kind === "route" && localPath.length === 0) {
    throw definitionError(`Route "${name}" must declare a non-empty path`)
  }
  if (localPath.length > 0) validatePath(name, localPath)
  const id = parentNode === undefined ? name : `${parentNode.id}.${name}`
  const path = joinPath(parentNode?.path ?? "", localPath)
  const inheritedParams = parentNode?.paramsSchema.fields ?? {}
  const inheritedSearch = parentNode?.searchSchema.fields ?? {}
  const params = mergeFields("params", id, inheritedParams, snapshotFields(options.params))
  const search = mergeFields("search", id, inheritedSearch, snapshotFields(options.search))
  if (kind === "route" || localPath.length > 0) validateRouteParameters(id, params, path)
  const node: AnyNode = {
    _tag: kind === "layout" ? "GroupDescriptor" : "RouteDescriptor",
    id,
    path,
    parentId: parentNode?.id,
    kind,
    paramsSchema: structSchema(params),
    searchSchema: structSchema(search),
    hashSchema: (options.hash as UrlCodec | undefined) ?? parentNode?.hashSchema
  }
  return node
}

const makeDefinition = <Presentation>(
  factory: DefinitionFactory<Presentation>,
  context: BuildContext,
  options: BuildOptions
): object => {
  if (options.prepare !== undefined && typeof options.prepare !== "function") {
    throw definitionError("prepare must be a direct function returning an Effect<void, E, R>")
  }
  if ("load" in options)
    throw definitionError("load is not supported; use a direct prepare gate and application-owned Atom resources")
  const node = buildNode(context, options)
  if (context.parent !== undefined && trustedDefinition(context.parent)?.owner !== factory) {
    throw definitionError(`Definition "${context.name}" belongs to a different renderer`)
  }
  const presentation = factory.normalize(options)
  const empty = options.empty === true
  Object.defineProperties(node, {
    "~parent": { value: context.parent },
    to: {
      value: (input: unknown, destinationOptions?: DestinationOptions) =>
        makeDestination(node, input, destinationOptions)
    }
  })
  if (context.kind === "layout") {
    Object.defineProperties(node, {
      route: {
        value: (name: string, path: string, childOptions?: BuildOptions) =>
          makeDefinition(
            factory,
            { kind: "route", parent: node, parentNode: node, name, localPath: path },
            childOptions ?? {}
          )
      },
      layout: {
        value: (name: string, path: string, childOptions?: BuildOptions) =>
          makeDefinition(
            factory,
            { kind: "layout", parent: node, parentNode: node, name, localPath: path },
            childOptions ?? {}
          )
      },
      index: {
        value: (childOptions?: BuildOptions) =>
          makeDefinition(
            factory,
            { kind: "route", parent: node, parentNode: node, name: "index", localPath: "/" },
            childOptions ?? {}
          )
      }
    })
  }
  records.set(
    node,
    Object.freeze({
      node,
      parent: context.parent,
      prepare: options.prepare,
      presentation:
        presentation !== null && typeof presentation === "object" ? Object.freeze(presentation) : presentation,
      empty,
      owner: factory
    })
  )
  return Object.freeze(node)
}

/**
 * Creates a top-level or nested endpoint definition. Intended for renderer
 * adapters and the core public constructors.
 *
 * @since 0.4.0
 * @category constructors
 */
export const defineRoute = <Presentation>(
  factory: DefinitionFactory<Presentation>,
  parent: object | undefined,
  name: string,
  path: string,
  options: unknown
): object =>
  makeDefinition(
    factory,
    {
      kind: "route",
      parent,
      parentNode: parent === undefined ? undefined : trustedDefinition(parent)?.node,
      name,
      localPath: path
    },
    (options ?? {}) as BuildOptions
  )

/**
 * Creates a top-level or nested layout definition.
 *
 * @since 0.4.0
 * @category constructors
 */
export const defineLayout = <Presentation>(
  factory: DefinitionFactory<Presentation>,
  parent: object | undefined,
  name: string,
  path: string,
  options: unknown
): object =>
  makeDefinition(
    factory,
    {
      kind: "layout",
      parent,
      parentNode: parent === undefined ? undefined : trustedDefinition(parent)?.node,
      name,
      localPath: path
    },
    (options ?? {}) as BuildOptions
  )

// --- assembly ---

/** The derived facts of one selection. @since 0.4.0 */
export interface Selection {
  readonly nodes: ReadonlyArray<AnyNode>
  readonly inputs: ReadonlyArray<{ readonly node: AnyNode; readonly prepare: unknown }>
  readonly presentations: ReadonlyMap<string, unknown>
}

/**
 * Validates selected definitions, derives their ancestry closure, and returns
 * the canonical nodes plus execution inputs and renderer presentations.
 *
 * Explicit duplicates, distinct objects sharing a qualified id, untrusted
 * values, and (when required) endpoints without presentation are rejected
 * before any application is built.
 *
 * @since 0.4.0
 * @category constructors
 */
export const collectSelection = <Presentation>(
  definitions: ReadonlyArray<unknown>,
  factory: DefinitionFactory<Presentation>
): Selection => {
  const order: Array<TrustedDefinition> = []
  const byId = new Map<string, object>()
  const visited = new Set<object>()
  const explicit = new Set<object>()
  const presentations = new Map<string, unknown>()
  const inputs: Array<{ readonly node: AnyNode; readonly prepare: unknown }> = []

  const collect = (definition: object): void => {
    if (visited.has(definition)) return
    const trusted = trustedDefinition(definition)
    if (trusted === undefined) {
      throw definitionError("Router.make requires constructor-owned route definitions")
    }
    if (trusted.owner !== factory) {
      throw definitionError(`Definition "${trusted.node.id}" belongs to a different renderer`)
    }
    visited.add(definition)
    if (trusted.parent !== undefined) collect(trusted.parent)
    const existing = byId.get(trusted.node.id)
    if (existing !== undefined && existing !== definition) {
      throw definitionError(`Two distinct definitions share the qualified id "${trusted.node.id}"`)
    }
    byId.set(trusted.node.id, definition)
    order.push(trusted)
    if (trusted.presentation !== undefined) presentations.set(trusted.node.id, trusted.presentation)
    if (trusted.prepare !== undefined) inputs.push({ node: trusted.node, prepare: trusted.prepare })
  }

  for (const definition of definitions) {
    if (!isObjectLike(definition)) {
      throw definitionError("Router.make requires constructor-owned route definitions")
    }
    if (explicit.has(definition)) {
      throw definitionError("Router.make received the same definition more than once")
    }
    explicit.add(definition)
    collect(definition)
  }

  if (factory.requiresPresentation) {
    for (const trusted of order) {
      if (trusted.node._tag !== "RouteDescriptor") continue
      if (!trusted.empty && factory.isEmpty(trusted.presentation as Presentation)) {
        throw definitionError(
          `Endpoint "${trusted.node.id}" has no presentation; provide a component/render or declare empty: true`
        )
      }
    }
  }
  return { nodes: order.map((trusted) => trusted.node), inputs, presentations }
}
