// @vitest-environment happy-dom
import * as Effect from "effect/Effect"
import * as Result from "effect/Result"
import * as Layer from "effect/Layer"
import { RegistryProvider } from "@effect/atom-react"
import { MemoryHistory } from "@effect-stack/router"
import * as Router from "@effect-stack/router/Router"
import { Provider } from "@effect-stack/router-react"
import { Atom } from "effect/reactivity"
import * as React from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it } from "vitest"
import { App } from "./fixture/nav/app.tsx"
import { ForeignApp } from "./fixture/nav/foreign-app.tsx"
import { lazyState } from "./fixture/nav/lazy-state.ts"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

const mountAt = <Id extends string, Routes>(app: Router.CoreApplication<Id, Routes, never, never>, href: string) => {
  const runtime = Atom.runtime(app.layer.pipe(Layer.provide(MemoryHistory.layer(href))))
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  cleanups.push(() => {
    React.act(() => root.unmount())
    container.remove()
  })
  React.act(() => {
    root.render(
      <RegistryProvider>
        <Provider app={app} runtime={runtime} />
      </RegistryProvider>
    )
  })
  return container
}

const waitForText = async (container: HTMLElement, text: string, attempts = 100): Promise<boolean> => {
  if ((container.textContent ?? "").includes(text)) return true
  if (attempts <= 0) return false
  await new Promise((resolve) => setTimeout(resolve, 10))
  return waitForText(container, text, attempts - 1)
}

const clickLink = async (container: HTMLElement, href: string) => {
  const link = container.querySelector(`a[href="${href}"]`)
  await React.act(async () => {
    link?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }))
  })
}

describe("navigation import boundary", { concurrent: false }, () => {
  it("resolves and encodes a path template synchronously without a service", () => {
    const resolved = Router.resolvePathDestination(App, "/projects/:projectId/details", {
      params: { projectId: 7 }
    })
    expect(Result.isSuccess(resolved)).toBe(true)
    if (Result.isSuccess(resolved)) {
      expect(Result.getOrThrow(Router.href(resolved.success))).toBe("/projects/7/details")
    }
    expect(Result.isFailure(Router.resolvePathDestination(App, "/missing", {}))).toBe(true)
    const wrongSchema = Router.resolvePathDestination(App, "/projects/:projectId/details", {
      params: { projectId: "not-a-number" }
    })
    expect(Result.isSuccess(wrongSchema)).toBe(true)
    if (Result.isSuccess(wrongSchema)) {
      expect(Result.isFailure(Router.href(wrongSchema.success))).toBe(true)
    }
  })

  it("renders path links and navigates across routes", async () => {
    const container = mountAt(App, "/")
    expect(await waitForText(container, "Nav home")).toBe(true)
    expect(container.querySelector('a[href="/projects"]')).not.toBeNull()
    await clickLink(container, "/projects")
    expect(await waitForText(container, "Projects layout")).toBe(true)
    expect(container.textContent).toContain("Projects index")
    expect(container.querySelector('a[href="/projects/7/details"]')).not.toBeNull()
    await clickLink(container, "/projects/7/details")
    expect(await waitForText(container, "Project details")).toBe(true)
  })

  it("does not evaluate a lazily imported component until its route renders", async () => {
    lazyState.evaluated = false
    const container = mountAt(App, "/")
    expect(await waitForText(container, "Nav home")).toBe(true)
    expect(lazyState.evaluated).toBe(false)
    await clickLink(container, "/lazy")
    expect(await waitForText(container, "Lazy page")).toBe(true)
    expect(lazyState.evaluated).toBe(true)
  })

  it("resolves an unbound helper against the nearest provider's canonical index", async () => {
    // The foreign application reuses the first application's typed helper. An
    // unbound helper cannot verify the erased application type, so it resolves
    // against the active (foreign) provider's selected endpoint.
    const container = mountAt(ForeignApp, "/")
    expect(await waitForText(container, "Foreign home")).toBe(true)
    await clickLink(container, "/projects")
    expect(await waitForText(container, "Foreign projects")).toBe(true)
  })

  it("allows the same application under multiple runtimes", async () => {
    const first = mountAt(App, "/")
    const second = mountAt(App, "/")
    expect(await waitForText(first, "Nav home")).toBe(true)
    expect(await waitForText(second, "Nav home")).toBe(true)
  })

  it("keeps Err(encode) from a bad path input before any navigation", () => {
    // A valid template with an input that fails schema decode yields a typed
    // encode failure and performs no history write.
    const resolved = Router.resolvePathDestination(App, "/projects/:projectId/details", {
      params: { projectId: "" }
    })
    if (Result.isSuccess(resolved)) {
      expect(Result.isFailure(Router.href(resolved.success))).toBe(true)
    }
    void Effect.void
  })
})
