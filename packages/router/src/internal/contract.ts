/**
 * Route declarations, bound contract nodes, runtime lowering, and identity
 * metadata. Internal module.
 *
 * Declarations are immutable, pipeable, non-callable descriptions created with
 * `Route.make` or `RouteGroup.make`. Binding a declaration into a collection
 * produces canonical bound nodes with effective paths, inherited inputs, and
 * runtime ownership.
 *
 * @since 0.4.0
 */
import * as Context from "effect/Context"
import type { Pipeable } from "effect/Pipeable"
import { pipeArguments } from "effect/Pipeable"
import * as Schema from "effect/Schema"
import { RouteDefinitionError } from "./errors.ts"
import type { UrlCodec, UrlFields, UrlSchema, UrlSchemaFields } from "./url.ts"

/** Struct field map accepted for URL sections. @since 0.4.0 */
export type Fields = Schema.Struct.Fields

/** Non-enumerable runtime nodes carried by a collection value. @since 0.4.0 */
export const ContractNodes: unique symbol = Symbol.for("@effect-stack/router/ContractNodes")

/** Non-enumerable internal declaration payload. @since 0.4.0 */
export const DeclarationData: unique symbol = Symbol.for("@effect-stack/router/DeclarationData")

/** Type brand for standalone route declarations. @since 0.4.0 */
export const RouteDeclarationTypeId: unique symbol = Symbol.for("@effect-stack/router/RouteDeclaration")

/** Type brand for standalone group declarations. @since 0.4.0 */
export const RouteGroupDeclarationTypeId: unique symbol = Symbol.for("@effect-stack/router/RouteGroupDeclaration")

/** Type brand for bound leaf nodes. @since 0.4.0 */
export const BoundRouteTypeId: unique symbol = Symbol.for("@effect-stack/router/BoundRoute")

/** Type brand for bound group nodes. @since 0.4.0 */
export const BoundGroupTypeId: unique symbol = Symbol.for("@effect-stack/router/BoundGroup")

/** Stable identifier of an implementation service. @since 0.4.0 */
export type ImplementationId<
  CollectionId extends string,
  RouteId extends string
> = `@effect-stack/router/${CollectionId}/impl/${RouteId}`

/** Stable identifier of a contract's runtime service. @since 0.4.0 */
export type ServiceId<CollectionId extends string> = `@effect-stack/router/${CollectionId}/service`

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
  Children = Record<string, AnyBoundNode>
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
  BoundRecord
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
  readonly node: AnyBoundRoute
  readonly input: unknown
  readonly replace: boolean
  readonly state: unknown
  readonly "~collection"?: CollectionId
}

/** Runtime node surface shared by route and group nodes. @since 0.4.0 */
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

/** Runtime route node including its addressable call. @since 0.4.0 */
export interface RuntimeRouteNode extends RuntimeNode {
  readonly _tag: "RouteDescriptor"
}

/** Runtime group node including its typed children. @since 0.4.0 */
export interface RuntimeGroupNode extends RuntimeNode {
  readonly _tag: "GroupDescriptor"
  readonly children: Record<string, RuntimeNode>
}

type StructType<F extends Fields> = Schema.Struct<F>["Type"]

type Section<K extends string, Value> = {} extends Value ? { readonly [P in K]?: Value } : { readonly [P in K]: Value }

type DestinationCall<I extends NodeInfo> =
  InputOf<I> extends infer Input
    ? {} extends Input
      ? (input?: Input, options?: DestinationOptions) => Destination<I["collectionId"]>
      : (input: Input, options?: DestinationOptions) => Destination<I["collectionId"]>
    : never

// --- declaration type surface ---

/** @since 0.4.0 */
export interface RouteDeclarationShape<
  Id extends string,
  Path extends string,
  Params extends Fields,
  Search extends Fields,
  Hash extends Schema.Top | undefined,
  Success extends Schema.Top | undefined,
  Error extends Schema.Top | undefined
> {
  readonly identifier: Id
  readonly path: Path
  readonly params: Params
  readonly search: Search
  readonly hash: Hash
  readonly success: Success
  readonly error: Error
}

/** @since 0.4.0 */
export interface RouteGroupDeclarationShape<
  Id extends string,
  Prefix extends string,
  Params extends Fields,
  Search extends Fields,
  Hash extends Schema.Top | undefined,
  Success extends Schema.Top | undefined,
  Error extends Schema.Top | undefined,
  Children extends DeclarationRecord
> {
  readonly identifier: Id
  readonly prefix: Prefix
  readonly params: Params
  readonly search: Search
  readonly hash: Hash
  readonly success: Success
  readonly error: Error
  readonly children: Children
}

/** A named map of nested declarations. @since 0.4.0 */
export type DeclarationRecord = { readonly [key: string]: AnyDeclaration }

/**
 * A reusable, non-callable route declaration.
 *
 * @since 0.4.0
 * @category models
 */
export interface RouteDeclaration<
  Id extends string = string,
  Path extends string = string,
  Params extends Fields = Fields,
  Search extends Fields = Fields,
  Hash extends Schema.Top | undefined = Schema.Top | undefined,
  Success extends Schema.Top | undefined = Schema.Top | undefined,
  Error extends Schema.Top | undefined = Schema.Top | undefined
> extends Pipeable {
  readonly [RouteDeclarationTypeId]: RouteDeclarationShape<Id, Path, Params, Search, Hash, Success, Error>
}

/**
 * A reusable, non-callable group declaration with immutable children and a
 * persistent mount prefix.
 *
 * @since 0.4.0
 * @category models
 */
export interface RouteGroupDeclaration<
  Id extends string = string,
  Prefix extends string = string,
  Params extends Fields = Fields,
  Search extends Fields = Fields,
  Hash extends Schema.Top | undefined = Schema.Top | undefined,
  Success extends Schema.Top | undefined = Schema.Top | undefined,
  Error extends Schema.Top | undefined = Schema.Top | undefined,
  Children extends DeclarationRecord = DeclarationRecord
> extends Pipeable {
  readonly [RouteGroupDeclarationTypeId]: RouteGroupDeclarationShape<
    Id,
    Prefix,
    Params,
    Search,
    Hash,
    Success,
    Error,
    Children
  >
  add<const A extends NonEmptyDeclarations>(
    ...declarations: A
  ): RouteGroupDeclaration<Id, Prefix, Params, Search, Hash, Success, Error, Children & DeclarationEntries<A>>
  prefix<const P extends `/${string}`>(
    prefix: P
  ): RouteGroupDeclaration<Id, PrependPrefix<Prefix, P>, Params, Search, Hash, Success, Error, Children>
}

/** @since 0.4.0 */
export type AnyDeclaration =
  | {
      readonly [RouteDeclarationTypeId]: RouteDeclarationShape<
        string,
        string,
        Fields,
        Fields,
        Schema.Top | undefined,
        Schema.Top | undefined,
        Schema.Top | undefined
      >
    }
  | {
      readonly [RouteGroupDeclarationTypeId]: RouteGroupDeclarationShape<
        string,
        string,
        Fields,
        Fields,
        Schema.Top | undefined,
        Schema.Top | undefined,
        Schema.Top | undefined,
        DeclarationRecord
      >
    }

/** @since 0.4.0 */
export type NonEmptyDeclarations = readonly [AnyDeclaration, ...Array<AnyDeclaration>]

// --- bound type surface ---

/** @since 0.4.0 */
export interface BoundRecord {
  readonly [key: string]: AnyBoundNode
}

/** @since 0.4.0 */
export type BoundRoute<
  CollectionId extends string = string,
  Id extends string = string,
  Path extends string = string,
  Params extends Fields = Fields,
  Search extends Fields = Fields,
  Hash extends Schema.Top | undefined = Schema.Top | undefined,
  Success extends Schema.Top | undefined = Schema.Top | undefined,
  Error extends Schema.Top | undefined = Schema.Top | undefined
> = {
  readonly [BoundRouteTypeId]: true
  readonly _tag: "RouteDescriptor"
  readonly collectionId: CollectionId
  readonly id: Id
  readonly path: Path
  readonly "~node": NodeInfo<CollectionId, Id, Path, Params, Search, Hash, Success, Error>
} & DestinationCall<NodeInfo<CollectionId, Id, Path, Params, Search, Hash, Success, Error>>

/** @since 0.4.0 */
export type BoundGroup<
  CollectionId extends string = string,
  Id extends string = string,
  Path extends string = string,
  Params extends Fields = Fields,
  Search extends Fields = Fields,
  Hash extends Schema.Top | undefined = Schema.Top | undefined,
  Success extends Schema.Top | undefined = Schema.Top | undefined,
  Error extends Schema.Top | undefined = Schema.Top | undefined,
  Children extends BoundRecord = BoundRecord
> = {
  readonly [BoundGroupTypeId]: true
  readonly _tag: "GroupDescriptor"
  readonly collectionId: CollectionId
  readonly id: Id
  readonly path: Path
  readonly "~node": GroupInfo<CollectionId, Id, Path, Params, Search, Hash, Success, Error, Children>
} & Children

/** @since 0.4.0 */
export interface AnyBoundRoute {
  readonly [BoundRouteTypeId]: true
  readonly _tag: "RouteDescriptor"
  readonly collectionId: string
  readonly id: string
  readonly path: string
  readonly "~node": AnyNodeInfo
}

/** @since 0.4.0 */
export interface AnyBoundGroup {
  readonly [BoundGroupTypeId]: true
  readonly _tag: "GroupDescriptor"
  readonly collectionId: string
  readonly id: string
  readonly path: string
  readonly "~node": AnyGroupInfo
}

/** @since 0.4.0 */
export type AnyBoundNode = AnyBoundRoute | AnyBoundGroup
/** A bound route or group node. @since 0.4.0 */
export type AnyNode = AnyBoundNode

/** Every bound node, including nested group children. @since 0.4.0 */
export type AllNodes<C> = C extends object
  ? { [K in keyof C]: C[K] extends AnyBoundNode ? C[K] | DescendantsOf<C[K]> : never }[keyof C]
  : never

type DescendantsOf<N> = N extends { readonly "~node": infer I }
  ? I extends { readonly children: infer Children }
    ? AllNodes<Children>
    : never
  : never

/** @since 0.4.0 */
export type InfoOf<D> = D extends { readonly "~node": infer I extends NodeInfo } ? I : never

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

type ImplementationIdOf<D> = D extends { readonly "~node": infer I extends NodeInfo }
  ? ImplementationId<I["collectionId"], I["id"]>
  : never

/** The union of implementation service identifiers required by a contract. @since 0.4.0 */
export type ImplementationRequirements<C> =
  AllNodes<C> extends infer N
    ? N extends AnyBoundNode
      ? NeedsImplementation<N> extends true
        ? ImplementationIdOf<N>
        : never
      : never
    : never

/**
 * The actual bound children of a contract or group, excluding service, builder
 * methods, and node metadata. Renderers derive view records from this.
 *
 * @since 0.4.0
 * @category type utilities
 */
export type ChildKeys<C> = {
  readonly [K in keyof C as C[K] extends AnyBoundNode ? K : never]: C[K]
}

/** The bound children carried by one group node. @since 0.4.0 */
export type ChildrenOf<G> = InfoOf<G> extends { readonly children: infer C } ? C : never

// --- path and identity type helpers ---

type JoinPath<Parent extends string, Child extends string> = Child extends "" | "/"
  ? Parent extends ""
    ? "/"
    : Parent
  : Parent extends "" | "/"
    ? Child
    : `${Parent}${Child}`

type PrependPrefix<Current extends string, Prefix extends string> = Prefix extends "/"
  ? Current
  : Current extends "" | "/"
    ? Prefix
    : `${Prefix}${Current}`

type Qualify<ParentId extends string, Id extends string> = ParentId extends "" ? Id : `${ParentId}.${Id}`

/** @since 0.4.0 */
export type DeclarationIdentifier<D> = D extends {
  readonly [RouteDeclarationTypeId]: { readonly identifier: infer Id extends string }
}
  ? Id
  : D extends { readonly [RouteGroupDeclarationTypeId]: { readonly identifier: infer Id extends string } }
    ? Id
    : never

type DeclarationEntry<D> = { readonly [K in DeclarationIdentifier<D>]: D }

/** @since 0.4.0 */
export type DeclarationEntries<Decls> = Decls extends readonly [infer Head, ...infer Tail]
  ? DeclarationEntry<Head> & DeclarationEntries<Tail>
  : unknown

/** @since 0.4.0 */
export type BindDeclaration<
  CollectionId extends string,
  D,
  ParentId extends string,
  ParentPath extends string,
  ParentParams extends Fields,
  ParentSearch extends Fields
> =
  D extends RouteGroupDeclaration<infer Id, infer Prefix, infer P, infer S, infer H, infer Su, infer E, infer Children>
    ? BoundGroup<
        CollectionId,
        Qualify<ParentId, Id>,
        JoinPath<ParentPath, Prefix>,
        ParentParams & P,
        ParentSearch & S,
        H,
        Su,
        E,
        BindChildren<
          CollectionId,
          Children,
          Qualify<ParentId, Id>,
          JoinPath<ParentPath, Prefix>,
          ParentParams & P,
          ParentSearch & S
        >
      >
    : D extends RouteDeclaration<infer Id, infer Path, infer P, infer S, infer H, infer Su, infer E>
      ? BoundRoute<
          CollectionId,
          Qualify<ParentId, Id>,
          JoinPath<ParentPath, Path>,
          ParentParams & P,
          ParentSearch & S,
          H,
          Su,
          E
        >
      : never

type BindChildren<
  CollectionId extends string,
  Children,
  ParentId extends string,
  ParentPath extends string,
  ParentParams extends Fields,
  ParentSearch extends Fields
> = {
  readonly [K in keyof Children]: Children[K] extends AnyDeclaration
    ? BindDeclaration<CollectionId, Children[K], ParentId, ParentPath, ParentParams, ParentSearch>
    : never
}

/** @since 0.4.0 */
export type BindEntries<
  CollectionId extends string,
  Decls,
  ParentId extends string = "",
  ParentPath extends string = "",
  ParentParams extends Fields = {},
  ParentSearch extends Fields = {}
> = Decls extends readonly [infer Head, ...infer Tail]
  ? {
      readonly [K in DeclarationIdentifier<Head>]: BindDeclaration<
        CollectionId,
        Head,
        ParentId,
        ParentPath,
        ParentParams,
        ParentSearch
      >
    } & BindEntries<CollectionId, Tail, ParentId, ParentPath, ParentParams, ParentSearch>
  : unknown

// --- runtime declaration payloads ---

interface RouteDeclarationRuntime {
  readonly kind: "route"
  readonly identifier: string
  readonly path: string
  readonly params: Fields
  readonly search: Fields
  readonly hash: Schema.Top | undefined
  readonly success: Schema.Top | undefined
  readonly error: Schema.Top | undefined
}

interface GroupDeclarationRuntime {
  readonly kind: "group"
  readonly identifier: string
  readonly prefix: string
  readonly params: Fields
  readonly search: Fields
  readonly hash: Schema.Top | undefined
  readonly success: Schema.Top | undefined
  readonly error: Schema.Top | undefined
  readonly children: Record<string, unknown>
}

type DeclarationRuntime = RouteDeclarationRuntime | GroupDeclarationRuntime

/** @since 0.4.0 */
export interface RouteOptions {
  readonly params?: UrlSchemaFields
  readonly search?: UrlSchemaFields
  readonly hash?: UrlSchema
  readonly success?: Schema.Top
  readonly error?: Schema.Top
}

/** @since 0.4.0 */
export type OptionsParams<O> = O extends { readonly params: infer P extends Fields } ? P : {}
/** @since 0.4.0 */
export type OptionsSearch<O> = O extends { readonly search: infer S extends Fields } ? S : {}
/** @since 0.4.0 */
export type OptionsHash<O> = O extends { readonly hash: infer H extends Schema.Top } ? H : undefined
/** @since 0.4.0 */
export type OptionsSuccess<O> = O extends { readonly success: infer S extends Schema.Top } ? S : undefined
/** @since 0.4.0 */
export type OptionsError<O> = O extends { readonly error: infer E extends Schema.Top } ? E : undefined

declare const InvalidContractOptions: unique symbol

type OptionalOptionKeys<O> = { [K in keyof O]-?: {} extends Pick<O, K> ? K : never }[keyof O]
type UndefinedOptionKeys<O> = { [K in keyof O]-?: undefined extends O[K] ? K : never }[keyof O]
type IsUnion<T, U = T> = [T] extends [never] ? false : T extends U ? ([U] extends [T] ? false : true) : never

/**
 * Rejects a widened, optional, or union `Route.Options` value. Only a concrete
 * object literal preserves the schema sections needed to type destinations,
 * handlers, and implementation requirements; a whole-options union would make
 * `NeedsImplementation` unsound by intersecting its keys to `never`.
 *
 * @since 0.4.0
 */
export type ContractOptionsGuard<O> =
  IsUnion<O> extends true
    ? {
        readonly [InvalidContractOptions]: "Route and group options must be a single concrete object literal; a union of options is not supported"
      }
    : [OptionalOptionKeys<O> | UndefinedOptionKeys<O>] extends [never]
      ? unknown
      : {
          readonly [InvalidContractOptions]: "Route and group options must be a concrete object literal; a widened or optional Route.Options is not supported"
        }

const declarationData = (declaration: unknown): DeclarationRuntime =>
  (declaration as { readonly [DeclarationData]: DeclarationRuntime })[DeclarationData]

const definitionError = (message: string): RouteDefinitionError => new RouteDefinitionError({ message })

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
  "add",
  "pipe",
  "prefix",
  "identifier",
  "params",
  "search",
  "hash",
  "success",
  "error",
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
  "~node"
])

const validateIdentifier = (identifier: string): void => {
  if (identifier.length === 0) throw definitionError("Route and group identifiers must not be empty")
  if (identifier.includes(".")) {
    throw definitionError(`Route or group identifier "${identifier}" must not contain "."`)
  }
  if (identifier.includes("/")) {
    throw definitionError(`Route or group identifier "${identifier}" must not contain "/"`)
  }
  if (reservedNames.has(identifier)) {
    throw definitionError(`Route or group identifier "${identifier}" is reserved`)
  }
}

/**
 * Validates a collection identifier. Collection identifiers are key components,
 * so they must not contain the `.` or `/` delimiters used to encode qualified
 * node and implementation identities.
 *
 * @since 0.4.0
 */
export const validateCollectionId = (collectionId: string): void => {
  if (collectionId.length === 0) throw definitionError("Collection identifier must not be empty")
  if (collectionId.includes(".")) {
    throw definitionError(`Collection identifier "${collectionId}" must not contain "."`)
  }
  if (collectionId.includes("/")) {
    throw definitionError(`Collection identifier "${collectionId}" must not contain "/"`)
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
  return { ...inherited, ...own }
}

const snapshotFields = (fields: Fields | undefined): Fields => (fields === undefined ? {} : { ...fields })

const structSchema = (fields: Fields): Schema.Struct<UrlFields> =>
  Schema.Struct(fields) as unknown as Schema.Struct<UrlFields>

const makeImplementationTag = (collectionId: string, id: string): Context.Service<unknown, unknown> =>
  Context.Service<unknown, unknown>(`@effect-stack/router/${collectionId}/impl/${id}`)

const decorateRoute = (node: RuntimeRouteNode): RuntimeRouteNode => {
  const call = (input?: unknown, options?: DestinationOptions): Destination =>
    makeDestination(call as unknown as AnyBoundRoute, input, options)
  return Object.assign(call, node) as unknown as RuntimeRouteNode
}

const decorateGroup = (node: RuntimeGroupNode): RuntimeGroupNode => {
  const output: Record<string, unknown> = { ...node }
  for (const [key, child] of Object.entries(node.children)) output[key] = child
  return output as unknown as RuntimeGroupNode
}

const makeDestination = (node: AnyBoundRoute, input: unknown, options: DestinationOptions | undefined): Destination => {
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

interface BindContext {
  readonly collectionId: string
  readonly parentId: string
  readonly parentPath: string
  readonly parentParams: Fields
  readonly parentSearch: Fields
}

const bindRoute = (context: BindContext, data: RouteDeclarationRuntime): RuntimeRouteNode => {
  const id = context.parentId === "" ? data.identifier : `${context.parentId}.${data.identifier}`
  const path = joinPath(context.parentPath, data.path)
  validatePath(id, path)
  const params = mergeFields("params", id, context.parentParams, data.params)
  const search = mergeFields("search", id, context.parentSearch, data.search)
  validateRouteParameters(id, params, path)
  const successSchema = data.success
  const errorSchema = data.error
  return decorateRoute({
    _tag: "RouteDescriptor",
    collectionId: context.collectionId,
    id,
    path,
    parentId: context.parentId === "" ? undefined : context.parentId,
    kind: data.path === "/" ? "index" : "route",
    paramsSchema: structSchema(params),
    searchSchema: structSchema(search),
    hashSchema: data.hash as UrlCodec | undefined,
    successSchema,
    errorSchema,
    implementationTag:
      successSchema !== undefined || errorSchema !== undefined
        ? makeImplementationTag(context.collectionId, id)
        : undefined
  })
}

const bindGroup = (context: BindContext, data: GroupDeclarationRuntime): RuntimeGroupNode => {
  const id = context.parentId === "" ? data.identifier : `${context.parentId}.${data.identifier}`
  const path = joinPath(context.parentPath, data.prefix)
  validatePath(id, path)
  const params = mergeFields("params", id, context.parentParams, data.params)
  const search = mergeFields("search", id, context.parentSearch, data.search)
  validateRouteParameters(id, params, path)
  const successSchema = data.success
  const errorSchema = data.error
  const children: Record<string, RuntimeNode> = {}
  const childContext: BindContext = {
    collectionId: context.collectionId,
    parentId: id,
    parentPath: path,
    parentParams: params,
    parentSearch: search
  }
  for (const key of Object.keys(data.children)) {
    const child = declarationData(data.children[key])
    if (child.identifier !== key) {
      throw definitionError(
        `Group "${id}" child key "${key}" does not match declaration identifier "${child.identifier}"`
      )
    }
    children[child.identifier] =
      child.kind === "route" ? bindRoute(childContext, child) : bindGroup(childContext, child)
  }
  return decorateGroup({
    _tag: "GroupDescriptor",
    collectionId: context.collectionId,
    id,
    path,
    parentId: context.parentId === "" ? undefined : context.parentId,
    kind: "layout",
    paramsSchema: structSchema(params),
    searchSchema: structSchema(search),
    hashSchema: data.hash as UrlCodec | undefined,
    successSchema,
    errorSchema,
    implementationTag:
      successSchema !== undefined || errorSchema !== undefined
        ? makeImplementationTag(context.collectionId, id)
        : undefined,
    children
  })
}

/** @since 0.4.0 */
export const bindDeclaration = (collectionId: string, declaration: unknown): RuntimeNode => {
  const data = declarationData(declaration)
  const context: BindContext = {
    collectionId,
    parentId: "",
    parentPath: "",
    parentParams: {},
    parentSearch: {}
  }
  return data.kind === "route" ? bindRoute(context, data) : bindGroup(context, data)
}

/**
 * The runtime surface of a collection contract value.
 *
 * @since 0.4.0
 */
export interface ContractRuntime {
  readonly collectionId: string
  readonly nodes: Record<string, RuntimeNode>
}

/** @since 0.4.0 */
export const getContractNodes = (contract: unknown): Record<string, RuntimeNode> =>
  (contract as { readonly [ContractNodes]: Record<string, RuntimeNode> })[ContractNodes]

/**
 * Binds new declarations and returns a new immutable collection runtime.
 *
 * @since 0.4.0
 */
export const addDeclarations = (current: ContractRuntime, declarations: ReadonlyArray<unknown>): ContractRuntime => {
  if (declarations.length === 0) throw definitionError("Router.add requires at least one declaration")
  const nodes: Record<string, RuntimeNode> = { ...current.nodes }
  for (const declaration of declarations) {
    const data = declarationData(declaration)
    if (data === undefined) {
      throw definitionError("Router.add requires standalone route or group declarations")
    }
    validateIdentifier(data.identifier)
    const node = bindDeclaration(current.collectionId, declaration)
    if (Object.prototype.hasOwnProperty.call(nodes, node.id)) {
      throw definitionError(`Duplicate route or group identifier "${node.id}"`)
    }
    nodes[node.id] = node
  }
  return { collectionId: current.collectionId, nodes }
}

/**
 * Creates an immutable route declaration.
 *
 * @since 0.4.0
 * @category constructors
 */
export const makeRouteDeclaration = (identifier: string, path: string, options?: RouteOptions): unknown => {
  validateIdentifier(identifier)
  if (path.length === 0) throw definitionError(`Route "${identifier}" must declare a non-empty path`)
  validatePath(identifier, path)
  const params = snapshotFields(options?.params)
  const search = snapshotFields(options?.search)
  validateRouteParameters(identifier, params, path)
  const data: RouteDeclarationRuntime = {
    kind: "route",
    identifier,
    path,
    params,
    search,
    hash: options?.hash,
    success: options?.success,
    error: options?.error
  }
  return withPipe({ [DeclarationData]: data })
}

/**
 * Creates an immutable group declaration.
 *
 * @since 0.4.0
 * @category constructors
 */
export const makeGroupDeclaration = (identifier: string, options?: RouteOptions): unknown => {
  validateIdentifier(identifier)
  const params = snapshotFields(options?.params)
  const search = snapshotFields(options?.search)
  const data: GroupDeclarationRuntime = {
    kind: "group",
    identifier,
    prefix: "",
    params,
    search,
    hash: options?.hash,
    success: options?.success,
    error: options?.error,
    children: {}
  }
  return groupDeclaration(data)
}

const groupDeclaration = (data: GroupDeclarationRuntime): unknown => {
  const value = withPipe({ [DeclarationData]: data })
  const record = value as unknown as { add: unknown; prefix: unknown }
  record.add = (...declarations: ReadonlyArray<unknown>) => groupAdd(data, declarations)
  record.prefix = (prefix: string) => groupPrefix(data, prefix)
  return value
}

const groupAdd = (data: GroupDeclarationRuntime, declarations: ReadonlyArray<unknown>): unknown => {
  if (declarations.length === 0)
    throw definitionError(`Group "${data.identifier}" add requires at least one declaration`)
  const children = { ...data.children }
  for (const declaration of declarations) {
    const child = declarationData(declaration)
    if (child === undefined) {
      throw definitionError(`Group "${data.identifier}" add requires standalone route or group declarations`)
    }
    validateIdentifier(child.identifier)
    if (Object.prototype.hasOwnProperty.call(children, child.identifier)) {
      throw definitionError(`Group "${data.identifier}" already declares child "${child.identifier}"`)
    }
    children[child.identifier] = declaration
  }
  return groupDeclaration({ ...data, children })
}

const groupPrefix = (data: GroupDeclarationRuntime, prefix: string): unknown => {
  if (prefix.length === 0) throw definitionError(`Group "${data.identifier}" prefix must not be empty`)
  validatePath(data.identifier, prefix)
  const next = prependPrefix(data.prefix, prefix)
  validateRouteParameters(data.identifier, data.params, next)
  return groupDeclaration({ ...data, prefix: next })
}

const prependPrefix = (current: string, prefix: string): string => {
  if (prefix === "/") return current
  if (current === "" || current === "/") return prefix
  return `${prefix}${current}`
}

const joinPath = (parentPath: string, child: string): string => {
  if (child === "" || child === "/") return parentPath === "" ? "/" : parentPath
  if (parentPath === "" || parentPath === "/") return child
  return `${parentPath}${child}`
}

const withPipe = <A extends object>(value: A): A & Pipeable => {
  Object.defineProperty(value, "pipe", {
    value: function (this: unknown): unknown {
      return pipeArguments(this, arguments)
    },
    enumerable: false,
    configurable: true,
    writable: true
  })
  return value as A & Pipeable
}

/** Collects every runtime node in a contract, ancestors first. @since 0.4.0 */
export const collectNodes = (routes: Record<string, RuntimeNode>): ReadonlyArray<RuntimeNode> => {
  const output: Array<RuntimeNode> = []
  const visit = (node: RuntimeNode): void => {
    output.push(node)
    if (node._tag === "GroupDescriptor") {
      for (const child of Object.values((node as RuntimeGroupNode).children)) visit(child)
    }
  }
  for (const node of Object.values(routes)) visit(node)
  return output
}

/** Looks up a runtime node by qualified id. @since 0.4.0 */
export const findNode = (routes: Record<string, RuntimeNode>, id: string): RuntimeNode | undefined =>
  collectNodes(routes).find((node) => node.id === id)

/** @since 0.4.0 */
export const describeDecodeError = (error: Schema.SchemaError): string => error.message
