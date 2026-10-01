// @vitest-environment happy-dom
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import { RegistryProvider } from "@effect/atom-react"
import { MemoryHistory } from "@effect-stack/router"
import { Link, make, Outlet, Provider, layout, route, type ViewFailureProps } from "@effect-stack/router-react"
import { Atom } from "effect/reactivity"
import * as React from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it } from "vitest"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

const mount = (element: React.ReactElement) => {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  cleanups.push(() => {
    React.act(() => root.unmount())
    container.remove()
  })
  React.act(() => {
    root.render(element)
  })
  return { container, root }
}

const waitForText = async (container: HTMLElement, text: string, attempts = 100): Promise<boolean> => {
  if ((container.textContent ?? "").includes(text)) return true
  if (attempts <= 0) return false
  await new Promise((resolve) => setTimeout(resolve, 10))
  return waitForText(container, text, attempts - 1)
}

const Home = route("home", "/", {
  component: () => (
    <main>
      <h1>Home</h1>
      <Link to={Slow.to()}>Slow</Link>
    </main>
  )
})

const Slow = route("slow", "/slow", {
  prepare: () => Effect.void,
  component: () => <h1>Ready</h1>,
  error: ({ retry }: ViewFailureProps) => <button onClick={retry}>Retry</button>
})

class AreaMissing extends Schema.TaggedError<AreaMissing>()("AreaMissing", { code: Schema.Number }) {}

const Areas = layout("areas", "/areas", {
  component: () => (
    <div data-testid="areas">
      <h2>Areas layout</h2>
      <Outlet />
    </div>
  )
})

const AreaDetail = Areas.route("detail", "/:areaId", {
  params: { areaId: Schema.FiniteFromString },
  prepare: () => Effect.fail(new AreaMissing({ code: 1 })),
  component: () => <p>Area</p>,
  error: ({ failure }: ViewFailureProps<AreaMissing>) => (
    <p data-testid="area-error">Area failed: {failure._tag === "Domain" ? String(failure.error) : "cause"}</p>
  )
})

const App = make("React", [Home, Slow, Areas, AreaDetail])

describe("react unified smoke", { concurrent: false }, () => {
  it("renders the native branch and follows a typed link", async () => {
    const runtime = Atom.runtime(App.layer.pipe(Layer.provide(MemoryHistory.layer("/"))))
    const { container } = mount(
      <RegistryProvider>
        <Provider app={App} runtime={runtime} pending={() => <p role="status">Preparing…</p>} />
      </RegistryProvider>
    )
    await React.act(async () => {})
    expect(await waitForText(container, "Home")).toBe(true)
    const link = container.querySelector("a")
    expect(link?.getAttribute("href")).toBe("/slow")
    await React.act(async () => {
      link?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }))
    })
    expect(await waitForText(container, "Ready")).toBe(true)
  })

  it("keeps an ancestor layout around a nested route failure", async () => {
    const runtime = Atom.runtime(App.layer.pipe(Layer.provide(MemoryHistory.layer("/areas/7"))))
    const { container } = mount(
      <RegistryProvider>
        <Provider app={App} runtime={runtime} pending={() => <p role="status">Preparing…</p>} />
      </RegistryProvider>
    )
    await React.act(async () => {})
    expect(await waitForText(container, "Areas layout")).toBe(true)
    expect(container.textContent).toContain("Area failed")
  })
})
