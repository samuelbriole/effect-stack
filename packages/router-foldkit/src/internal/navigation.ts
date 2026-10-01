import { resolveNavigationTarget } from "@effect-stack/router/Adapter"
import * as Router from "@effect-stack/router/Router"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import * as Subscription from "foldkit/subscription"
import type { Attribute, ChildAttribute, Html, HtmlBuilder } from "foldkit/html"
import { NavigationRequest, type RouterMessage } from "./state.ts"
import { decodeInput, encodeInput } from "./snapshot.ts"

/** Only JSON history state crosses the Foldkit Message seam. Explicit undefined clears destination state. @since 0.1.0 */
export interface NavigateOptions {
  readonly replace?: boolean
  readonly state?: Schema.Json | undefined
}

/** @since 0.1.0 */
export interface LinkOptions<Message = never> extends NavigateOptions {
  readonly attributes?: ReadonlyArray<Attribute<Message> | ChildAttribute>
}

const jsonString = Schema.fromJsonString(Schema.Json)
const requestString = Schema.fromJsonString(NavigationRequest)
const marker = "data-effect-stack-router"
const requestAttribute = "data-effect-stack-navigation"

export const makeNavigation = <Routes>(app: unknown, nodes: ReadonlyArray<Router.AnyNode>, linkId: string) => {
  const byId = new Map(nodes.map((node) => [node.id, node]))

  const destination = (request: NavigationRequest): Router.DestinationOf<Routes> => {
    const node = byId.get(request.id)
    if (node === undefined || node.kind !== "route") {
      throw new Router.RouteEncodeError({ routeId: request.id, part: "path", message: "Not a selected endpoint" })
    }
    const input = decodeInput(node, request.input)
    // The request has been decoded with a selected endpoint's canonical codecs.
    return Result.getOrThrow(
      resolveNavigationTarget(app, {
        to: node.path,
        params: input.params,
        search: input.search,
        hash: input.hash
      })
    ) as Router.DestinationOf<Routes>
  }

  const request = (target: Router.NavigateTarget<Routes>, options?: NavigateOptions): NavigationRequest => {
    const resolved = Result.getOrThrow(resolveNavigationTarget(app, target))
    const node = byId.get(resolved.node.id)
    if (node === undefined || node !== resolved.node || node.kind !== "route") {
      throw new Router.RouteEncodeError({
        routeId: resolved.node.id,
        part: "path",
        message: "Destination does not belong to this application"
      })
    }
    const href = Result.getOrThrow(Router.href(resolved))
    const url = new URL(href, "https://effect-stack.invalid")
    const input = Schema.decodeUnknownSync(
      Schema.Struct({
        params: Schema.optional(Schema.Unknown),
        search: Schema.optional(Schema.Unknown),
        hash: Schema.optional(Schema.Unknown)
      })
    )(resolved.input)
    const state = options !== undefined && Object.hasOwn(options, "state") ? options.state : resolved.state
    return {
      id: node.id,
      input: encodeInput(node, {
        params: input.params ?? {},
        search: input.search ?? {},
        hash: input.hash,
        location: { pathname: url.pathname, search: url.search, hash: url.hash }
      }),
      replace: options?.replace ?? resolved.replace,
      state: state === undefined ? null : Schema.encodeUnknownSync(jsonString)(state)
    }
  }

  const href = (value: NavigationRequest) => Result.getOrThrow(Router.href(destination(value)))

  const link = <Message>(
    h: HtmlBuilder<Message>,
    target: Router.NavigateTarget<Routes>,
    children: ReadonlyArray<Html | string>,
    options?: LinkOptions<Message>
  ): Html => {
    const value = request(target, options)
    return h.a(
      [
        ...(options?.attributes ?? []),
        h.Href(href(value)),
        h.Attribute(marker, linkId),
        h.Attribute(requestAttribute, Schema.encodeSync(requestString)(value))
      ],
      children
    )
  }

  const links = (root: () => Document | HTMLElement, applicationId: string) =>
    Subscription.fromEventFilterMapPreventDefault({
      target: root,
      type: "click",
      filterMapEvent: (event): Option.Option<RouterMessage> => {
        if (
          event.defaultPrevented
          || event.button !== 0
          || event.altKey
          || event.ctrlKey
          || event.metaKey
          || event.shiftKey
        )
          return Option.none()
        const element = event.composedPath().find((item): item is Element => item instanceof Element)
        const anchor = element?.closest("a")
        if (
          anchor === undefined
          || anchor === null
          || anchor.getAttribute(marker) !== linkId
          || anchor.hasAttribute("download")
        )
          return Option.none()
        const target =
          anchor.getAttribute("target")
          ?? anchor.ownerDocument.querySelector("base[target]")?.getAttribute("target")
          ?? "_self"
        if (target.toLowerCase() !== "_self") return Option.none()
        const encoded = anchor.getAttribute(requestAttribute)
        if (encoded === null) return Option.none()
        const decoded = Schema.decodeUnknownOption(requestString)(encoded)
        if (Option.isNone(decoded)) return Option.none()
        try {
          const url = new URL(anchor.href)
          if (
            !["http:", "https:"].includes(url.protocol)
            || url.origin !== anchor.ownerDocument.location.origin
            || url.href !== new URL(href(decoded.value), anchor.ownerDocument.baseURI).href
          )
            return Option.none()
          return Option.some({ _tag: "RequestedNavigation", applicationId, request: decoded.value })
        } catch {
          return Option.none()
        }
      }
    })

  return { request, destination, link, links }
}
