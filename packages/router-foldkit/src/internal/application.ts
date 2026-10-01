import * as Adapter from "@effect-stack/router/Adapter"
import type * as Router from "@effect-stack/router/Router"
import * as Presentation from "@effect-stack/router/Presentation"
import * as Option from "effect/Option"
import type * as Layer from "effect/Layer"
import type * as Update from "foldkit/update"
import type { Html, HtmlBuilder } from "foldkit/html"
import {
  makeRouteConstructors,
  type NativeDefinition,
  type ErrorView,
  type RouteConstructor,
  type LayoutConstructor
} from "./route.ts"
import { makeConnection, type Connection, type ConnectionId, type ConnectionOptions } from "./connection.ts"
import { makeNavigation, type NavigateOptions, type LinkOptions } from "./navigation.ts"
import { decodeInput, decodeFailure } from "./snapshot.ts"
import { initialState, diagnostic, type State, type RouterMessage, type Failure, type Entry } from "./state.ts"

/** Application-owned Model lens and Message lift. Schemas can be declared before route views. @since 0.1.0 */
export interface RendererOptions<Model, Message> {
  readonly getState: (model: Model) => State
  readonly setState: (model: Model, state: State) => Model
  readonly toMessage: (message: RouterMessage) => Message
  readonly pending?: (model: Model, h: HtmlBuilder<Message>) => Html
  readonly notFound?: (model: Model, h: HtmlBuilder<Message>) => Html
  readonly error?: ErrorView<Model, Message, never>
}

/** @since 0.1.0 */
export type Definitions<Model, Message> = readonly [
  Router.AnyDefinitionShape & NativeDefinition<Model, Message>,
  ...Array<Router.AnyDefinitionShape & NativeDefinition<Model, Message>>
]

/** The canonical core application, extended with explicit native integration. @since 0.1.0 */
export type Application<
  Model,
  Message,
  AppId extends string,
  Defs extends Definitions<Model, Message>
> = Router.ApplicationOf<AppId, Defs> & {
  readonly initialState: State
  readonly connect: <StartupE>(
    layer: Layer.Layer<Router.ApplicationOf<AppId, Defs>["service"]["Identifier"], StartupE>,
    options?: ConnectionOptions
  ) => Connection<Model, Message, AppId>
  readonly update: (model: Model, message: RouterMessage) => Update.Return<Model, Message, ConnectionId<AppId>>
  readonly view: (model: Model, h: HtmlBuilder<Message>) => Html
  readonly input: <D extends Router.AnyDefinitionShape & NativeDefinition<Model, Message>>(
    state: State,
    definition: D
  ) => Option.Option<Router.DecodedRouteInputOfDef<D>>
  readonly navigate: (target: Router.NavigateTarget<Defs>, options?: NavigateOptions) => Message
  readonly link: (
    h: HtmlBuilder<Message>,
    target: Router.NavigateTarget<Defs>,
    children: ReadonlyArray<Html | string>,
    options?: LinkOptions<Message>
  ) => Html
  readonly retry: () => Message
  readonly refresh: () => Message
  readonly back: () => Message
  readonly forward: () => Message
  readonly go: (delta: number) => Message
  readonly cancel: (attempt: number) => Message
}

/** @since 0.1.0 */
export interface Renderer<Model, Message> {
  readonly route: RouteConstructor<Model, Message>
  readonly layout: LayoutConstructor<Model, Message>
  readonly make: <const AppId extends string, const Defs extends Definitions<Model, Message>>(
    appId: AppId,
    definitions: Defs
  ) => Application<Model, Message, AppId, Defs>
}

/** Native constructors and application assembly for one Model/Message universe. @since 0.1.0 */
export const create = <Model, Message>(options: RendererOptions<Model, Message>): Renderer<Model, Message> => {
  const constructors = makeRouteConstructors<Model, Message>()
  const make = <const AppId extends string, const Defs extends Definitions<Model, Message>>(
    appId: AppId,
    definitions: Defs
  ): Application<Model, Message, AppId, Defs> => {
    const app = Adapter.finishApplication(constructors.engine, appId, definitions)
    const nodes = Adapter.getApplicationNodes(constructors.engine, app)
    const byId = new Map(nodes.map((node) => [node.id, node]))
    const views = Adapter.getApplicationViews(constructors.engine, app)
    const navigation = makeNavigation<Defs>(app, nodes, app.service.key)
    const { connect, update } = makeConnection(app, views, navigation, options.toMessage, options.setState)

    const command = (
      name: Extract<RouterMessage, { readonly _tag: "RequestedRouterCommand" }>["command"],
      value = 0
    ): Message =>
      options.toMessage({
        _tag: "RequestedRouterCommand",
        applicationId: appId,
        command: name,
        value
      })
    const retry = (): Message => command("Retry")
    const pending = (model: Model, h: HtmlBuilder<Message>) =>
      options.pending === undefined ? h.div([h.Role("status")], ["Loading…"]) : options.pending(model, h)
    const defaultError = (
      model: Model,
      h: HtmlBuilder<Message>,
      failure: Extract<Failure, { readonly _tag: "Diagnostic" }>,
      canRetry: boolean
    ): Html => {
      if (canRetry && options.error !== undefined) return options.error({ model, h, failure, retry: retry() })
      return h.div(
        [h.Role("alert")],
        ["Unable to display this route.", ...(canRetry ? [h.button([h.OnClick(retry())], ["Retry"])] : [])]
      )
    }
    const invalidState = (model: Model, h: HtmlBuilder<Message>, error: unknown) =>
      defaultError(model, h, { _tag: "Diagnostic", diagnostic: diagnostic("snapshot", error) }, false)

    const view = (model: Model, h: HtmlBuilder<Message>): Html => {
      const state = options.getState(model)
      if (state.applicationId !== appId || state.version !== 1) return pending(model, h)
      if (state.connection === "Connecting") return pending(model, h)
      if (state.entries.some((entry) => !byId.has(entry.id)))
        return invalidState(model, h, "Snapshot contains an unknown definition")
      const snapshot: Presentation.DisplaySnapshot<Entry, Failure> =
        state.display === "RouterFailure"
          ? {
              _tag: "RouterFailure",
              entries: [],
              failure: {
                _tag: "Diagnostic",
                diagnostic: state.diagnostic ?? diagnostic("snapshot", "Missing router failure")
              }
            }
          : { _tag: state.display, entries: state.entries }
      const outlet = (depth: number): Html => {
        const decision = Presentation.selectOutlet(snapshot, depth, views, {})
        switch (decision._tag) {
          case "Empty":
            return null
          case "Pending":
            return pending(model, h)
          case "NotFound":
            return options.notFound === undefined
              ? h.div([h.Role("status")], ["Page not found"])
              : options.notFound(model, h)
          case "RouterFailure":
            return defaultError(
              model,
              h,
              { _tag: "Diagnostic", diagnostic: state.diagnostic ?? diagnostic("router", "Router failed") },
              state.connection === "Ready"
            )
          case "Failure": {
            const failure = decodeFailure(decision.failure, decision.view.errorSchema)
            return decision.view.error === undefined
              ? defaultError(
                  model,
                  h,
                  failure._tag === "Diagnostic"
                    ? failure
                    : { _tag: "Diagnostic", diagnostic: diagnostic("gate", "Route preparation failed") },
                  true
                )
              : decision.view.error({ model, h, failure, retry: retry() })
          }
          case "View": {
            const node = byId.get(decision.entry.id)
            if (node === undefined || decision.entry.input === null)
              return invalidState(model, h, "Snapshot has no decoded input")
            let input: ReturnType<typeof decodeInput>
            try {
              input = decodeInput(node, decision.entry.input)
            } catch (error) {
              return invalidState(model, h, error)
            }
            return decision.view.render?.({ model, h, input, outlet: () => outlet(decision.nextDepth) }) ?? null
          }
        }
      }
      return outlet(0)
    }

    const input = <D extends Router.AnyDefinitionShape & NativeDefinition<Model, Message>>(
      state: State,
      definition: D
    ): Option.Option<Router.DecodedRouteInputOfDef<D>> => {
      const node = Adapter.getApplicationNode(constructors.engine, app, definition)
      if (state.applicationId !== appId || state.connection !== "Ready") return Option.none()
      const entry = state.entries.find((candidate) => candidate.id === node.id)
      if (entry?.input === null || entry?.input === undefined) return Option.none()
      try {
        // Canonical membership and decoding establish the constructor's exact input type.
        return Option.some(decodeInput(node, entry.input) as Router.DecodedRouteInputOfDef<D>)
      } catch {
        return Option.none()
      }
    }
    return Object.assign(app, {
      initialState: initialState(appId),
      connect,
      update,
      view,
      input,
      navigate: (target: Router.NavigateTarget<Defs>, navigateOptions?: NavigateOptions): Message =>
        options.toMessage({
          _tag: "RequestedNavigation",
          applicationId: appId,
          request: navigation.request(target, navigateOptions)
        }),
      link: (
        h: HtmlBuilder<Message>,
        target: Router.NavigateTarget<Defs>,
        children: ReadonlyArray<Html | string>,
        linkOptions?: LinkOptions<Message>
      ): Html => navigation.link(h, target, children, linkOptions),
      retry,
      refresh: (): Message => command("Refresh"),
      back: (): Message => command("Back"),
      forward: (): Message => command("Forward"),
      go: (delta: number): Message => command("Go", delta),
      cancel: (attempt: number): Message => command("Cancel", attempt)
    })
  }
  return { route: constructors.route, layout: constructors.layout, make }
}
