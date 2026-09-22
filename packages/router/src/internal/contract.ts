/**
 * Route contract descriptors: typed destination constructors, qualified node
 * identities, and implementation keys. Internal module.
 *
 * @since 0.4.0
 */
import * as Context from "effect/Context"
import * as Schema from "effect/Schema"
import { RouteDefinitionError } from "./errors.ts"
import type { UrlCodec, UrlFields } from "./url.ts"

/** Struct field map accepted for URL sections. @since 0.4.0 */
export type Fields = Schema.Struct.Fields

/** Non-enumerable runtime nodes carried by a contract value. @since 0.4.0 */
export const ContractNodes: unique symbol = Symbol.for("@effect-stack/router/ContractNodes")

/**
 * The declarative shape accepted by `Router.schema`.
 *
 * @since 0.4.0
 * @category models
 */
export type ContractDef =
  | string
  | {
      readonly path?: string
      readonly params?: Fields
      readonly search?: Fields
      readonly hash?: Schema.Top
      readonly success?: Schema.Top
      readonly error?: Schema.Top
      readonly children?: ContractDefs
    }

/** A named map of nested contract definitions. @since 0.4.0 */
export type ContractDefs = { readonly [key: string]: ContractDef }

/** Stable identifier of an implementation service. @since 0.4.0 */
export type ImplementationId<
  CollectionId extends string,
  RouteId extends string
> = `@effect-stack/router/${CollectionId}/impl/${RouteId}`

/** Stable identifier of a contract's runtime service. @since 0.4.0 */
export type ServiceId<CollectionId extends string> = `@effect-stack/router/${CollectionId}/service`

type JoinPath<Parent extends string, Child extends string> = Child extends `/${string}`
  ? Child
  : Child extends ""
    ? Parent extends ""
      ? "/"
      : Parent
    : Parent extends "" | "/"
      ? `/${Child}`
      : `${Parent}/${Child}`

type QualifiedId<ParentId extends string, Key extends string> = ParentId extends "" ? Key : `${ParentId}.${Key}`

type DefPath<ParentPath extends string, Def> = Def extends { readonly path: infer Path extends string }
  ? JoinPath<ParentPath, Path>
  : ParentPath extends ""
    ? "/"
    : ParentPath

type OwnParams<Def> = Def extends { readonly params: infer P extends Fields } ? P : {}
type OwnSearch<Def> = Def extends { readonly search: infer S extends Fields } ? S : {}
type OwnHash<Def> = Def extends { readonly hash: infer H extends Schema.Top } ? H : undefined
type OwnSuccess<Def> = Def extends { readonly success: infer S extends Schema.Top } ? S : undefined
type OwnError<Def> = Def extends { readonly error: infer E extends Schema.Top } ? E : undefined

type StructType<F extends Fields> = Schema.Struct<F>["Type"]

type Section<K extends string, Value> = {} extends Value ? { readonly [P in K]?: Value } : { readonly [P in K]: Value }

/**
 * Describes one addressable or non-addressable node in a contract.
 *
 * @since 0.4.0
 * @category models
 */
export interface NodeInfo<
  CollectionId extends string = string,
  Id extends string = string,
  Path extends string = string,
  Params extends Fields = Fields,
  Search extends Fields = Fields,
  Hash extends Schema.Top | undefined = Schema.Top | undefined,
  Success extends Schema.Top | undefined = Schema.Top | undefined,
  Error extends Schema.Top | undefined = Schema.Top | undefined
> {
  readonly collectionId: CollectionId
  readonly id: Id
  readonly path: Path
  readonly params: Params
  readonly search: Search
  readonly hash: Hash
  readonly success: Success
  readonly error: Error
}

/** A non-addressable group node with typed children. @since 0.4.0 */
export interface GroupInfo<
  CollectionId extends string = string,
  Id extends string = string,
  Path extends string = string,
  Params extends Fields = Fields,
  Search extends Fields = Fields,
  Hash extends Schema.Top | undefined = Schema.Top | undefined,
  Success extends Schema.Top | undefined = Schema.Top | undefined,
  Error extends Schema.Top | undefined = Schema.Top | undefined,
  Children = Record<string, AnyNode>
> extends NodeInfo<CollectionId, Id, Path, Params, Search, Hash, Success, Error> {
  readonly children: Children
}

/** @since 0.4.0 */
export type AnyNodeInfo = NodeInfo<
  string,
  string,
  string,
  Fields,
  Fields,
  Schema.Top | undefined,
  Schema.Top | undefined,
  Schema.Top | undefined
>

/** @since 0.4.0 */
export type AnyGroupInfo = GroupInfo<
  string,
  string,
  string,
  Fields,
  Fields,
  Schema.Top | undefined,
  Schema.Top | undefined,
  Schema.Top | undefined,
  Record<string, AnyNode>
>

/** @since 0.4.0 */
export type DestinationOptions = {
  readonly replace?: boolean
  readonly state?: unknown
}

/**
 * A constructed destination. The call signature that produced it already
 * validated its input; navigation encodes it at runtime.
 *
 * @since 0.4.0
 * @category models
 */
export interface Destination<CollectionId extends string = string> {
  readonly _tag: "@effect-stack/router/Destination"
  readonly node: AnyRouteDescriptor
  readonly input: unknown
  readonly replace: boolean
  readonly state: unknown
  readonly "~collection"?: CollectionId
}

/** Runtime node surface shared by route and group descriptors. @since 0.4.0 */
export interface RuntimeNode {
  readonly _tag: "RouteDescriptor" | "GroupDescriptor"
  readonly collectionId: string
  readonly id: string
  readonly path: string
  readonly parentId: string | undefined
  readonly kind: "route" | "index" | "layout"
  readonly paramsSchema: Schema.Struct<UrlFields>
  readonly searchSchema: Schema.Struct<UrlFields>
  readonly hashSchema: UrlCodec | undefined
  readonly successSchema: Schema.Top | undefined
  readonly errorSchema: Schema.Top | undefined
  readonly implementationTag: Context.Service<unknown, unknown> | undefined
}

/** Runtime route descriptor including its addressable call. @since 0.4.0 */
export interface RuntimeRouteNode extends RuntimeNode {
  readonly _tag: "RouteDescriptor"
}

/** Runtime group descriptor including its typed children. @since 0.4.0 */
export interface RuntimeGroupNode extends RuntimeNode {
  readonly _tag: "GroupDescriptor"
  readonly children: Record<string, RuntimeNode>
}

/** @since 0.4.0 */
export interface NodeCarrier<I extends NodeInfo> {
  readonly "~node": I
}

type DestinationCall<I extends NodeInfo> =
  InputOf<I> extends infer Input
    ? {} extends Input
      ? (input?: Input, options?: DestinationOptions) => Destination<I["collectionId"]>
      : (input: Input, options?: DestinationOptions) => Destination<I["collectionId"]>
    : never

/**
 * A typed, callable route descriptor.
 *
 * @since 0.4.0
 * @category models
 */
export type RouteDescriptor<I extends NodeInfo = AnyNodeInfo> = RuntimeRouteNode & NodeCarrier<I> & DestinationCall<I>

/**
 * A non-addressable group descriptor carrying its children as direct
 * properties.
 *
 * @since 0.4.0
 * @category models
 */
export type GroupDescriptor<I extends AnyGroupInfo = AnyGroupInfo> = RuntimeGroupNode & I["children"] & NodeCarrier<I>

/** @since 0.4.0 */
export type AnyRouteDescriptor = RuntimeRouteNode & NodeCarrier<AnyNodeInfo>
/** @since 0.4.0 */
export type AnyGroupDescriptor = RuntimeGroupNode & NodeCarrier<AnyGroupInfo>
/** @since 0.4.0 */
export type AnyNode = AnyRouteDescriptor | AnyGroupDescriptor

/** @since 0.4.0 */
export type InfoOf<D> = D extends NodeCarrier<infer I> ? I : never

/** @since 0.4.0 */
export type IdOf<D> = InfoOf<D>["id"]
/** @since 0.4.0 */
export type ParamsOf<D> = StructType<InfoOf<D>["params"]>
/** @since 0.4.0 */
export type SearchOf<D> = StructType<InfoOf<D>["search"]>
/** @since 0.4.0 */
export type HashOf<D> = InfoOf<D>["hash"] extends Schema.Top ? InfoOf<D>["hash"]["Type"] : undefined
/** @since 0.4.0 */
export type SuccessOf<D> = InfoOf<D>["success"] extends Schema.Top ? InfoOf<D>["success"]["Type"] : void
/** @since 0.4.0 */
export type ErrorOf<D> = InfoOf<D>["error"] extends Schema.Top ? InfoOf<D>["error"]["Type"] : never

/**
 * The effective decoded input sections for one node. A section is omitted when
 * the node declares no fields for it, and optional when its decoded type can be
 * empty.
 *
 * @since 0.4.0
 * @category type utilities
 */
export type InputOf<I extends NodeInfo> = ([keyof I["params"]] extends [never]
  ? {}
  : Section<"params", StructType<I["params"]>>)
  & ([keyof I["search"]] extends [never] ? {} : Section<"search", StructType<I["search"]>>)
  & (I["hash"] extends Schema.Top ? Section<"hash", I["hash"]["Type"]> : {})

/** @since 0.4.0 */
export type InputOfNode<D> = InputOf<InfoOf<D>>

/**
 * The decoded input supplied to a handler. Unlike destination input, every
 * section is present: an undeclared section decodes to its empty value.
 *
 * @since 0.4.0
 * @category models
 */
export type HandlerInput<I extends NodeInfo> = {
  readonly params: StructType<I["params"]>
  readonly search: StructType<I["search"]>
  readonly hash: I["hash"] extends Schema.Top ? I["hash"]["Type"] : undefined
  readonly location: {
    readonly pathname: string
    readonly search: string
    readonly hash: string
  }
}

/** @since 0.4.0 */
export type HandlerInputOf<D> = HandlerInput<InfoOf<D>>

/**
 * True when a node declares a success or error contract and therefore requires
 * an implementation Layer.
 *
 * @since 0.4.0
 * @category type utilities
 */
export type NeedsImplementation<D> = InfoOf<D>["success"] extends Schema.Top
  ? true
  : InfoOf<D>["error"] extends Schema.Top
    ? true
    : false

type ImplementationIdOf<D> = D extends NodeCarrier<infer I> ? ImplementationId<I["collectionId"], I["id"]> : never

/** The union of implementation service identifiers required by a contract. @since 0.4.0 */
export type ImplementationRequirements<C> =
  AllNodes<C> extends infer N
    ? N extends AnyNode
      ? NeedsImplementation<N> extends true
        ? ImplementationIdOf<N>
        : never
      : never
    : never

type DescriptorFor<
  CollectionId extends string,
  Key extends string,
  Def,
  ParentPath extends string,
  ParentParams extends Fields,
  ParentSearch extends Fields,
  ParentId extends string
> = Def extends string
  ? RouteDescriptor<
      NodeInfo<
        CollectionId,
        QualifiedId<ParentId, Key>,
        JoinPath<ParentPath, Def>,
        ParentParams,
        ParentSearch,
        undefined,
        undefined,
        undefined
      >
    >
  : Def extends { readonly children: infer Children extends ContractDefs }
    ? GroupDescriptor<
        GroupInfo<
          CollectionId,
          QualifiedId<ParentId, Key>,
          DefPath<ParentPath, Def>,
          ParentParams & OwnParams<Def>,
          ParentSearch & OwnSearch<Def>,
          OwnHash<Def>,
          OwnSuccess<Def>,
          OwnError<Def>,
          ContractRoutes<
            CollectionId,
            Children,
            DefPath<ParentPath, Def>,
            ParentParams & OwnParams<Def>,
            ParentSearch & OwnSearch<Def>,
            QualifiedId<ParentId, Key>
          >
        >
      >
    : RouteDescriptor<
        NodeInfo<
          CollectionId,
          QualifiedId<ParentId, Key>,
          DefPath<ParentPath, Def>,
          ParentParams & OwnParams<Def>,
          ParentSearch & OwnSearch<Def>,
          OwnHash<Def>,
          OwnSuccess<Def>,
          OwnError<Def>
        >
      >

/**
 * The typed descriptor record produced for one level of a contract.
 *
 * @since 0.4.0
 * @category type utilities
 */
export type ContractRoutes<
  CollectionId extends string,
  Defs extends ContractDefs,
  ParentPath extends string = "",
  ParentParams extends Fields = {},
  ParentSearch extends Fields = {},
  ParentId extends string = ""
> = {
  readonly [K in keyof Defs & string]: DescriptorFor<
    CollectionId,
    K,
    Defs[K],
    ParentPath,
    ParentParams,
    ParentSearch,
    ParentId
  >
}

/** Every node in a contract, including nested group children. @since 0.4.0 */
export type AllNodes<C> = C extends object
  ? { [K in keyof C]: C[K] extends AnyNode ? C[K] | DescendantsOf<C[K]> : never }[keyof C]
  : never

type DescendantsOf<N> =
  N extends NodeCarrier<infer I>
    ? I extends { readonly children: infer Children }
      ? AllNodes<Children>
      : never
    : never

// --- runtime construction ---

const reservedNames = new Set([
  "_tag",
  "collectionId",
  "id",
  "path",
  "parentId",
  "kind",
  "children",
  "paramsSchema",
  "searchSchema",
  "hashSchema",
  "successSchema",
  "errorSchema",
  "implementationTag",
  "service",
  "~node"
])

const pathSegments = (path: string): ReadonlyArray<string> => (path === "/" ? [] : path.slice(1).split("/"))

const parameterNames = (path: string): ReadonlyArray<string> =>
  pathSegments(path)
    .filter((segment) => segment.startsWith(":"))
    .map((segment) => segment.slice(1))

const describeSchemaError = (error: Schema.SchemaError): string => error.message

const validatePath = (id: string, path: string): void => {
  if (!path.startsWith("/")) {
    throw new RouteDefinitionError({ message: `Route "${id}" path must start with /` })
  }
  if (path !== "/" && path.endsWith("/")) {
    throw new RouteDefinitionError({ message: `Route "${id}" path must not end with /` })
  }
  if (path.includes("//")) {
    throw new RouteDefinitionError({ message: `Route "${id}" path must not contain repeated separators` })
  }
  if (pathSegments(path).some((segment) => segment === "." || segment === "..")) {
    throw new RouteDefinitionError({ message: `Route "${id}" path must not contain . or .. segments` })
  }
}

const validateFields = (id: string, params: Fields, path: string): void => {
  const expected = [...parameterNames(path)].sort()
  const actual = Object.keys(params).sort()
  if (expected.length !== actual.length || expected.some((parameter, index) => parameter !== actual[index])) {
    throw new RouteDefinitionError({
      message: `Route "${id}" path parameters (${expected.join(", ")}) do not match params fields (${actual.join(", ")})`
    })
  }
}

interface BuildContext {
  readonly collectionId: string
  readonly parentId: string | undefined
  readonly parentPath: string
  readonly parentParams: Fields
  readonly parentSearch: Fields
}

const joinPath = (parentPath: string, child: string): string => {
  if (child.startsWith("/")) return child
  if (child === "") return parentPath === "" ? "/" : parentPath
  if (parentPath === "" || parentPath === "/") return `/${child}`
  return `${parentPath}/${child}`
}

const makeImplementationTag = (collectionId: string, id: string): Context.Service<unknown, unknown> =>
  Context.Service<unknown, unknown>(`@effect-stack/router/${collectionId}/impl/${id}`)

const buildNode = (context: BuildContext, key: string, def: ContractDef): RuntimeNode => {
  if (typeof def === "string") {
    return decorate(buildRoute(context, key, def))
  }
  if (reservedNames.has(key)) {
    throw new RouteDefinitionError({ message: `Route name "${key}" is reserved` })
  }
  if (def.children !== undefined) {
    return decorate(buildGroup(context, key, def as Exclude<ContractDef, string> & { readonly children: ContractDefs }))
  }
  return decorate(buildRoute(context, key, def))
}

const buildGroup = (
  context: BuildContext,
  key: string,
  def: Exclude<ContractDef, string> & { readonly children: ContractDefs }
): RuntimeGroupNode => {
  const id = context.parentId === undefined ? key : `${context.parentId}.${key}`
  const localPath = def.path ?? ""
  const path =
    localPath === "" ? (context.parentPath === "" ? "/" : context.parentPath) : joinPath(context.parentPath, localPath)
  validatePath(id, path)
  const params = { ...context.parentParams, ...def.params }
  const search = { ...context.parentSearch, ...def.search }
  validateFields(id, params, path)
  const successSchema = def.success
  const errorSchema = def.error
  const implementationTag =
    successSchema !== undefined || errorSchema !== undefined
      ? makeImplementationTag(context.collectionId, id)
      : undefined
  const children: Record<string, RuntimeNode> = {}
  const childContext: BuildContext = {
    collectionId: context.collectionId,
    parentId: id,
    parentPath: path,
    parentParams: params,
    parentSearch: search
  }
  for (const childKey of Object.keys(def.children)) {
    children[childKey] = buildNode(childContext, childKey, def.children[childKey] as ContractDef)
  }
  return {
    _tag: "GroupDescriptor",
    collectionId: context.collectionId,
    id,
    path,
    parentId: context.parentId,
    kind: "layout",
    paramsSchema: Schema.Struct(params),
    searchSchema: Schema.Struct(search),
    hashSchema: def.hash,
    successSchema,
    errorSchema,
    implementationTag,
    children
  } as RuntimeGroupNode
}

const buildRoute = (
  context: BuildContext,
  key: string,
  def: string | Exclude<ContractDef, string>
): RuntimeRouteNode => {
  const declaredPath = typeof def === "string" ? def : def.path
  if (declaredPath === undefined) {
    throw new RouteDefinitionError({ message: `Route "${key}" must declare a path` })
  }
  const id = context.parentId === undefined ? key : `${context.parentId}.${key}`
  const path = joinPath(context.parentPath, declaredPath)
  validatePath(id, path)
  const params = { ...context.parentParams, ...(typeof def === "string" ? {} : def.params) }
  const search = { ...context.parentSearch, ...(typeof def === "string" ? {} : def.search) }
  validateFields(id, params, path)
  const successSchema = typeof def === "string" ? undefined : def.success
  const errorSchema = typeof def === "string" ? undefined : def.error
  const hashSchema = typeof def === "string" ? undefined : def.hash
  const implementationTag =
    successSchema !== undefined || errorSchema !== undefined
      ? makeImplementationTag(context.collectionId, id)
      : undefined
  const kind = declaredPath === "" || (declaredPath === "/" && context.parentPath === "/") ? "index" : "route"
  return {
    _tag: "RouteDescriptor",
    collectionId: context.collectionId,
    id,
    path,
    parentId: context.parentId,
    kind,
    paramsSchema: Schema.Struct(params),
    searchSchema: Schema.Struct(search),
    hashSchema,
    successSchema,
    errorSchema,
    implementationTag
  } as RuntimeRouteNode
}

const makeDestination = (
  node: RuntimeRouteNode,
  input: unknown,
  options: DestinationOptions | undefined
): Destination => {
  const candidate = (input ?? {}) as { readonly params?: unknown; readonly search?: unknown; readonly hash?: unknown }
  return {
    _tag: "@effect-stack/router/Destination",
    node: node as AnyRouteDescriptor,
    input: {
      params: candidate.params ?? {},
      search: candidate.search ?? {},
      hash: candidate.hash
    },
    replace: options?.replace ?? false,
    state: options?.state
  }
}

const decorate = (node: RuntimeNode): RuntimeNode => {
  if (node._tag === "RouteDescriptor") {
    const route = node as RuntimeRouteNode
    const call = (input?: unknown, options?: DestinationOptions): Destination => makeDestination(route, input, options)
    return Object.assign(call, route) as unknown as RuntimeRouteNode
  }
  const group = node as RuntimeGroupNode
  const output: Record<string, unknown> = { ...group }
  for (const [key, child] of Object.entries(group.children)) {
    output[key] = child
  }
  return output as unknown as RuntimeGroupNode
}

const buildRoutes = (collectionId: string, defs: ContractDefs): Record<string, RuntimeNode> => {
  const context: BuildContext = {
    collectionId,
    parentId: undefined,
    parentPath: "",
    parentParams: {},
    parentSearch: {}
  }
  const output: Record<string, RuntimeNode> = {}
  for (const key of Object.keys(defs)) {
    if (reservedNames.has(key)) {
      throw new RouteDefinitionError({ message: `Route name "${key}" is reserved` })
    }
    output[key] = buildNode(context, key, defs[key] as ContractDef)
  }
  return output
}

/**
 * Builds the runtime contract value for `Router.schema`.
 *
 * @since 0.4.0
 * @category constructors
 */
export const makeContract = <const CollectionId extends string, const Defs extends ContractDefs>(
  collectionId: CollectionId,
  defs: Defs
): {
  readonly routes: Record<string, RuntimeNode>
  readonly service: Context.Service<ServiceId<CollectionId>, unknown>
} => {
  const routes = buildRoutes(collectionId, defs)
  const service = Context.Service<ServiceId<CollectionId>, unknown>(`@effect-stack/router/${collectionId}/service`)
  return { routes, service }
}

/** Collects every runtime node in a contract, ancestors first. @since 0.4.0 */
export const collectNodes = (routes: Record<string, RuntimeNode>): ReadonlyArray<RuntimeNode> => {
  const output: Array<RuntimeNode> = []
  const visit = (node: RuntimeNode): void => {
    output.push(node)
    if (node._tag === "GroupDescriptor") {
      const group = node as RuntimeGroupNode
      for (const child of Object.values(group.children)) visit(child)
    }
  }
  for (const node of Object.values(routes)) visit(node)
  return output
}

/** Looks up a runtime node by qualified id. @since 0.4.0 */
export const findNode = (routes: Record<string, RuntimeNode>, id: string): RuntimeNode | undefined =>
  collectNodes(routes).find((node) => node.id === id)

/** @since 0.4.0 */
export const describeDecodeError = describeSchemaError
