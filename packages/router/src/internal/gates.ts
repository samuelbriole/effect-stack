/** Renderer-neutral gate type evidence. @since 0.4.0 */
import type { AnyNodeInfo } from "./definition.ts"

/** Application marker. @since 0.4.0 */
export const CoreApplicationTypeId: unique symbol = Symbol.for("@effect-stack/router/CoreApplication")
/** Internal invariant application evidence. @since 0.4.0 */
export const ApplicationTypesTypeId: unique symbol = Symbol.for("@effect-stack/router/ApplicationTypes")
const ApplicationServiceTypesTypeId: unique symbol = Symbol.for("@effect-stack/router/ApplicationServiceTypes")

/** Normalized own gate evidence. @since 0.4.0 */
export interface GateTypes<E = unknown, R = unknown> {
  readonly error: E
  readonly requirements: R
}

/** Internal invariant carrier. @since 0.4.0 */
export interface ApplicationTypes<E, R> {
  readonly [ApplicationTypesTypeId]: (types: GateTypes<E, R>) => GateTypes<E, R>
}
/** Truthful runtime identity function. @since 0.4.0 */
export const applicationTypesBrand = <E, R>(types: GateTypes<E, R>): GateTypes<E, R> => types

/** Invariant application service identity. @since 0.4.0 */
export type ApplicationServiceId<
  AppId extends string,
  E = unknown,
  R = unknown
> = `@effect-stack/router/${AppId}/service` & {
  readonly [ApplicationServiceTypesTypeId]: (types: GateTypes<E, R>) => GateTypes<E, R>
}

type Safe<T> = 0 extends 1 & T ? unknown : T
type OwnGate<Def> = 0 extends 1 & Def
  ? GateTypes
  : [Def] extends [never]
    ? GateTypes
    : Def extends {
          readonly "~gate": infer Gate extends GateTypes
        }
      ? 0 extends 1 & Gate
        ? GateTypes
        : [Gate] extends [never]
          ? GateTypes
          : GateTypes<Safe<Gate["error"]>, Safe<Gate["requirements"]>>
      : GateTypes

/** The definition's own normalized gate failure. @since 0.4.0 */
export type ErrorOf<Def> = OwnGate<Def>["error"]
/** The definition's own normalized gate requirements. @since 0.4.0 */
export type RequirementsOf<Def> = OwnGate<Def>["requirements"]

type Chain<Def, Key extends keyof GateTypes, Seen = never> = 0 extends 1 & Def
  ? unknown
  : [Def] extends [never]
    ? unknown
    : unknown extends Def
      ? unknown
      : [Def] extends [undefined]
        ? never
        : Def extends Seen
          ? unknown
          : Def extends { readonly "~node": infer Node extends AnyNodeInfo; readonly "~parent": infer Parent }
            ? 0 extends 1 & Node
              ? unknown
              : [Node] extends [never]
                ? unknown
                : string extends Node["id"]
                  ? unknown
                  : OwnGate<Def>[Key] | Chain<Parent, Key, Seen | Def>
            : unknown

type Selection<Defs, Key extends keyof GateTypes> = 0 extends 1 & Defs
  ? unknown
  : [Defs] extends [never]
    ? unknown
    : Defs extends readonly [infer Head, ...infer Tail]
      ? Chain<Head, Key> | Selection<Tail, Key>
      : Defs extends readonly []
        ? never
        : unknown

/** Aggregate failure through real parent chains. @since 0.4.0 */
export type SelectionError<Defs> = Selection<Defs, "error">
/** Aggregate requirements through real parent chains. @since 0.4.0 */
export type SelectionRequirements<Defs> = Selection<Defs, "requirements">

/** Aggregate application failure. @since 0.4.0 */
export type ApplicationErrorOf<App> = App extends {
  readonly [ApplicationTypesTypeId]: (types: infer Types extends GateTypes) => unknown
}
  ? Safe<Types["error"]>
  : unknown
/** Aggregate application requirements. @since 0.4.0 */
export type ApplicationRequirementsOf<App> = App extends {
  readonly [ApplicationTypesTypeId]: (types: infer Types extends GateTypes) => unknown
}
  ? Safe<Types["requirements"]>
  : unknown
/** Selected routes. @since 0.4.0 */
export type RoutesOf<App> = App extends { readonly routes: infer Routes } ? Routes : never
/** Application identifier. @since 0.4.0 */
export type AppIdOf<App> = App extends { readonly appId: infer Id extends string } ? Id : never
