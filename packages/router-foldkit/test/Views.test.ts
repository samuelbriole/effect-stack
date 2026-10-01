// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from "@effect/vitest"
import { MemoryHistory } from "@effect-stack/router"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as Runtime from "foldkit/runtime"
import type { Html } from "foldkit/html"
import type { Window } from "happy-dom"
import { create, type RouterMessage, State } from "@effect-stack/router-foldkit"

beforeAll(() => {
  // Exercise native default-action decisions without issuing actual network requests.
  const navigation = (window as unknown as Window).happyDOM.settings.navigation
  navigation.disableMainFrameNavigation = true
  navigation.disableChildFrameNavigation = true
  navigation.disableChildPageNavigation = true
})

const rendered = (root: HTMLElement, predicate: () => boolean) =>
  new Promise<void>((resolve) => {
    if (predicate()) {
      resolve()
      return
    }
    const observer = new MutationObserver(() => {
      if (predicate()) {
        observer.disconnect()
        resolve()
      }
    })
    observer.observe(root, { subtree: true, childList: true, characterData: true })
  })

const requiredElement = <E extends Element>(root: ParentNode, selector: string): E => {
  const element = root.querySelector<E>(selector)
  if (element === null) throw new Error(`Missing element: ${selector}`)
  return element
}

const fixture = () => {
  const root = document.createElement("div")
  const container = document.createElement("div")
  container.id = `foldkit-${crypto.randomUUID()}`
  root.append(container)
  document.body.append(root)
  const routes = create<State, RouterMessage>({
    getState: (state) => state,
    setState: (_, state) => state,
    toMessage: (message) => message
  })
  const Shell = routes.layout("shell", "/", {
    render: ({ h, outlet }) => h.section([h.Attribute("data-layout", "shell")], [h.header([], ["Shell"]), outlet()])
  })
  const Home = Shell.index({
    render: ({ h }): Html =>
      h.div([], [h.p([], ["Home"]), App.link(h, Page.to({ params: { id: 12 } }), [h.span([], ["Visit page"])])])
  })
  const Page = Shell.route("page", "/page/:id", {
    params: { id: Schema.FiniteFromString },
    render: ({ h, input }) => h.article([], [`Page ${input.params.id}`])
  })
  const App = routes.make("BrowserViews", [Home, Page])
  const connection = App.connect(App.layer.pipe(Layer.provide(MemoryHistory.layer("/"))), { linkRoot: () => root })
  const program = Runtime.makeElement({
    Model: State,
    container,
    init: () => ({ model: App.initialState }),
    update: App.update,
    view: App.view,
    resources: connection.resources,
    subscriptions: connection.subscriptions,
    devTools: false
  })
  const handle = Runtime.embed(program)
  return { root, handle, App }
}

describe("native Foldkit router views", () => {
  it("renders layout outlets with the public Foldkit runtime and follows an anchor through the shared router", async () => {
    const { root, handle } = fixture()
    try {
      await rendered(root, () => root.querySelector("a") !== null)
      expect(root.querySelector("[data-layout=shell] header")?.textContent).toBe("Shell")
      const anchor = requiredElement<HTMLAnchorElement>(root, "a")
      expect(anchor.getAttribute("href")).toBe("/page/12")
      const click = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })
      requiredElement<HTMLSpanElement>(anchor, "span").dispatchEvent(click)
      expect(click.defaultPrevented).toBe(true)
      await rendered(root, () => root.querySelector("article") !== null)
      expect(root.querySelector("article")?.textContent).toBe("Page 12")
      expect(root.querySelector("header")?.textContent).toBe("Shell")
    } finally {
      handle.dispose()
      await rendered(root, () => root.textContent === "")
      root.remove()
    }
  })

  it("preserves native anchor behavior for modifiers, non-self targets, downloads and prevented events, and removes listeners on dispose", async () => {
    const { root, handle } = fixture()
    try {
      await rendered(root, () => root.querySelector("a") !== null)
      const anchor = requiredElement<HTMLAnchorElement>(root, "a")
      for (const modifier of ["altKey", "ctrlKey", "metaKey", "shiftKey"] as const) {
        const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, [modifier]: true })
        anchor.dispatchEvent(event)
        expect(event.defaultPrevented).toBe(false)
      }
      for (const attribute of ["target", "download"] as const) {
        anchor.setAttribute(attribute, attribute === "target" ? "_blank" : "file")
        const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })
        anchor.dispatchEvent(event)
        expect(event.defaultPrevented).toBe(false)
        anchor.removeAttribute(attribute)
      }
      const right = new MouseEvent("click", { bubbles: true, cancelable: true, button: 2 })
      anchor.dispatchEvent(right)
      expect(right.defaultPrevented).toBe(false)
      const prevented = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })
      prevented.preventDefault()
      anchor.dispatchEvent(prevented)
      expect(root.querySelector("article")).toBeNull()
      // Keep an identical marked anchor in the same root after disposal to distinguish
      // listener removal from simply removing the original rendered anchor.
      const clone = anchor.cloneNode(true)
      handle.dispose()
      await rendered(root, () => root.textContent === "")
      root.append(clone)
      const after = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })
      clone.dispatchEvent(after)
      expect(after.defaultPrevented).toBe(false)
    } finally {
      handle.dispose()
      root.remove()
    }
  })

  it("restores a typed gate error for its native error view and retries via a real Foldkit command", async () => {
    const root = document.createElement("div")
    const container = document.createElement("div")
    container.id = `foldkit-${crypto.randomUUID()}`
    root.append(container)
    document.body.append(root)
    let allowed = false
    const routes = create<State, RouterMessage>({
      getState: (state) => state,
      setState: (_, state) => state,
      toMessage: (message) => message
    })
    const Protected = routes.route("protected", "/", {
      prepare: () => Effect.suspend(() => (allowed ? Effect.void : Effect.fail({ code: "denied", count: 2 }))),
      errorSchema: Schema.Struct({ code: Schema.String, count: Schema.FiniteFromString }),
      error: ({ h, failure, retry }) =>
        h.div(
          [],
          [
            failure._tag === "Domain" ? `${failure.error.code}:${failure.error.count}` : "diagnostic",
            h.button([h.OnClick(retry)], ["Retry"])
          ]
        ),
      render: ({ h }) => h.article([], ["Protected content"])
    })
    const App = routes.make("BrowserErrors", [Protected])
    const connection = App.connect(App.layer.pipe(Layer.provide(MemoryHistory.layer("/"))), { linkRoot: () => root })
    const handle = Runtime.embed(
      Runtime.makeElement({
        Model: State,
        container,
        init: () => ({ model: App.initialState }),
        update: App.update,
        view: App.view,
        resources: connection.resources,
        subscriptions: connection.subscriptions,
        devTools: false
      })
    )
    try {
      await rendered(root, () => root.querySelector("button") !== null)
      expect(root.textContent).toBe("denied:2Retry")
      allowed = true
      requiredElement<HTMLButtonElement>(root, "button").click()
      await rendered(root, () => root.querySelector("article") !== null)
      expect(root.textContent).toBe("Protected content")
    } finally {
      handle.dispose()
      await rendered(root, () => root.textContent === "")
      root.remove()
    }
  })

  it("renders startup failure without an unusable retry action", async () => {
    const root = document.createElement("div")
    const container = document.createElement("div")
    container.id = `foldkit-${crypto.randomUUID()}`
    root.append(container)
    document.body.append(root)
    const routes = create<State, RouterMessage>({
      getState: (state) => state,
      setState: (_, state) => state,
      toMessage: (message) => message,
      error: ({ h, retry }) => h.button([h.OnClick(retry)], ["Custom retry"])
    })
    const Home = routes.route("home", "/", { empty: true })
    const App = routes.make("BrowserStartupFailure", [Home])
    const connection = App.connect(Layer.effect(App.service, Effect.fail("unavailable")), { linkRoot: false })
    const handle = Runtime.embed(
      Runtime.makeElement({
        Model: State,
        container,
        init: () => ({ model: App.initialState }),
        update: App.update,
        view: App.view,
        resources: connection.resources,
        subscriptions: connection.subscriptions,
        devTools: false
      })
    )
    try {
      await rendered(root, () => root.querySelector("[role=alert]") !== null)
      expect(root.textContent).toBe("Unable to display this route.")
      expect(root.querySelector("button")).toBeNull()
    } finally {
      handle.dispose()
      await rendered(root, () => root.textContent === "")
      root.remove()
    }
  })
})
