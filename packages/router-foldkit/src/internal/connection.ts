import type * as Router from "@effect-stack/router/Router"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Ref from "effect/Ref"
import * as Option from "effect/Option"
import * as Cause from "effect/Cause"
import * as Scope from "effect/Scope"
import * as Exit from "effect/Exit"
import * as Stream from "effect/Stream"
import * as Schema from "effect/Schema"
import * as Command from "foldkit/command"
import * as Subscription from "foldkit/subscription"
import type * as Update from "foldkit/update"
import { RouteDefinitionError, RouteEncodeError } from "@effect-stack/router/Router"
import { RouterMessage, initialState, causeDiagnostic, diagnostic, type State } from "./state.ts"
import { toState } from "./snapshot.ts"
import type { ResolvedViewOptions } from "./route.ts"
import type { makeNavigation } from "./navigation.ts"

/** The per-runtime connection requirement, distinct from the executable router service. @since 0.1.0 */
export interface ConnectionId<AppId extends string> {
  readonly "~foldkitRouterConnection": AppId
}

/** @since 0.1.0 */
export interface ConnectionOptions {
  /** Default: document. Use a container for embeds, or false for non-DOM programs. @since 0.1.0 */
  readonly linkRoot?: false | (() => Document | HTMLElement)
}

/** Supply both fields to Foldkit's runtime, composing its other resources/subscriptions normally. @since 0.1.0 */
export interface Connection<Model, Message, AppId extends string> {
  readonly resources: Layer.Layer<ConnectionId<AppId>>
  readonly subscriptions: {
    readonly router: Subscription.Subscription<Model, Message, Record<string, never>, ConnectionId<AppId>>
  }
}

interface Cell<Routes, E> {
  readonly running: Ref.Ref<boolean>
  readonly router: Ref.Ref<Option.Option<Router.RouterService<Routes, E>>>
  readonly handles: Map<number, Router.NavigationHandle<E>>
}

type Intent = Extract<RouterMessage, { readonly _tag: "RequestedNavigation" | "RequestedRouterCommand" }>
const Intent = Schema.Union([RouterMessage.members[1], RouterMessage.members[2]])

export const makeConnection = <Model, Message, AppId extends string, Routes, E, R>(
  app: Router.CoreApplication<AppId, Routes, E, R>,
  views: ReadonlyMap<string, ResolvedViewOptions<Model, Message>>,
  navigation: ReturnType<typeof makeNavigation<Routes>>,
  toMessage: (message: RouterMessage) => Message,
  setState: (model: Model, state: State) => Model
) => {
  const service = Context.Service<ConnectionId<AppId>, Cell<Routes, E>>(`${app.service.key}/foldkit`)
  const completed = (
    outcome: Extract<RouterMessage, { readonly _tag: "CompletedRouterCommand" }>["outcome"],
    failure: State["diagnostic"] = null
  ): Extract<RouterMessage, { readonly _tag: "CompletedRouterCommand" }> => ({
    _tag: "CompletedRouterCommand",
    applicationId: app.appId,
    outcome,
    diagnostic: failure
  })

  const execute = Command.define("EffectStack.Router", {
    args: { intent: Intent },
    messages: [RouterMessage.members[3]],
    execute: ({ intent }) =>
      Effect.gen(function* () {
        const cell = yield* service
        const current = yield* Ref.get(cell.router)
        if (Option.isNone(current)) return completed("Rejected", diagnostic("command", "Router is not connected"))
        const router = current.value
        if (intent._tag === "RequestedNavigation") {
          const destination = yield* Effect.try({
            try: () => navigation.destination(intent.request),
            catch: (error) =>
              new RouteEncodeError({
                routeId: intent.request.id,
                part: "path",
                message: diagnostic("navigation", error).message
              })
          })
          const historyState =
            intent.request.state === null
              ? undefined
              : yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Json))(intent.request.state)
          const handle = yield* router.submit(destination, {
            replace: intent.request.replace,
            state: historyState
          })
          // History writes can complete out of order. Only a newer attempt may
          // retire older handles; a superseded return must never erase its successor.
          for (const id of cell.handles.keys()) {
            if (id < handle.id) cell.handles.delete(id)
          }
          cell.handles.set(handle.id, handle)
          return yield* handle.await.pipe(
            Effect.map((outcome) => completed(outcome)),
            Effect.ensuring(
              Effect.gen(function* () {
                const state = yield* router.state
                if (state.status._tag !== "Pending" || state.status.attempt !== handle.id)
                  cell.handles.delete(handle.id)
              })
            )
          )
        }
        switch (intent.command) {
          case "Retry":
            return completed(yield* router.retry)
          case "Refresh":
            return completed(yield* router.refresh)
          case "Back":
            yield* router.back
            return completed("Accepted")
          case "Forward":
            yield* router.forward
            return completed("Accepted")
          case "Go":
            yield* router.go(intent.value)
            return completed("Accepted")
          case "Cancel": {
            const handle = cell.handles.get(intent.value)
            if (handle !== undefined) yield* handle.cancel
            return completed("Accepted")
          }
        }
      }).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.interrupt
            : Effect.succeed(completed("Rejected", causeDiagnostic("command", cause)))
        )
      )
  })

  const connect = <StartupE>(
    layer: Layer.Layer<Router.ApplicationServiceId<AppId, E, R>, StartupE>,
    options?: ConnectionOptions
  ): Connection<Model, Message, AppId> => {
    const resources = Layer.effect(
      service,
      Effect.gen(function* () {
        return {
          running: yield* Ref.make(false),
          router: yield* Ref.make(Option.none<Router.RouterService<Routes, E>>()),
          handles: new Map()
        }
      })
    )
    const changes = Stream.unwrap(
      Effect.gen(function* () {
        const cell = yield* service
        yield* Effect.acquireRelease(
          Effect.gen(function* () {
            if (yield* Ref.getAndSet(cell.running, true)) {
              return yield* Effect.die(new RouteDefinitionError({ message: "Router connection is already subscribed" }))
            }
            return cell
          }),
          (owned) =>
            Effect.gen(function* () {
              yield* Ref.set(owned.router, Option.none())
              owned.handles.clear()
              yield* Ref.set(owned.running, false)
            })
        )
        const scope = yield* Effect.acquireRelease(Scope.make(), (owned) => Scope.close(owned, Exit.void))
        const acquisition = yield* Effect.exit(
          Effect.gen(function* () {
            const context = yield* Layer.buildWithScope(layer, scope)
            const router = yield* Effect.try({
              try: () => Context.get(context, app.service),
              catch: () => new RouteDefinitionError({ message: "Router service is missing from the connection layer" })
            })
            if (router.applicationId !== app.appId || router.routes !== app.routes || router.token !== app.token) {
              return yield* Effect.fail(
                new RouteDefinitionError({ message: "Router connection does not belong to this application" })
              )
            }
            return router
          })
        )
        if (Exit.isFailure(acquisition)) {
          yield* Scope.close(scope, acquisition)
          if (Cause.hasInterruptsOnly(acquisition.cause)) return yield* Effect.interrupt
          const failure: State = Object.assign(initialState(app.appId), {
            connection: "StartupFailed" as const,
            display: "RouterFailure" as const,
            diagnostic: causeDiagnostic("startup", acquisition.cause)
          })
          return Stream.make({ _tag: "RouterStateChanged", state: failure } satisfies RouterMessage).pipe(
            Stream.concat(Stream.never)
          )
        }
        const router = acquisition.value
        yield* Ref.set(cell.router, Option.some(router))
        const snapshots = router.changes.pipe(
          Stream.map((state): RouterMessage => ({
            _tag: "RouterStateChanged",
            state: toState(app.appId, state, views)
          }))
        )
        const root = options?.linkRoot
        return root === false
          ? snapshots
          : snapshots.pipe(Stream.merge(navigation.links(root ?? (() => document), app.appId)))
      })
    )
    const stream = Stream.make({
      _tag: "RouterStateChanged",
      state: initialState(app.appId)
    } satisfies RouterMessage).pipe(Stream.concat(changes), Stream.map(toMessage))
    const subscriptions = Subscription.make<Model, Message, ConnectionId<AppId>>()(() => ({
      router: Subscription.persistent(stream)
    }))
    return { resources, subscriptions }
  }

  const update = (model: Model, message: RouterMessage): Update.Return<Model, Message, ConnectionId<AppId>> => {
    if (message._tag === "RouterStateChanged") {
      return { model: message.state.applicationId === app.appId ? setState(model, message.state) : model }
    }
    if (message.applicationId !== app.appId || message._tag === "CompletedRouterCommand") return { model }
    return { model, commands: [Command.mapMessage(execute({ intent: message }), toMessage)] }
  }
  return { connect, update }
}
