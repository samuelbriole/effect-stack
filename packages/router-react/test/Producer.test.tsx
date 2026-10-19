// @vitest-environment happy-dom
import * as Layer from "effect/Layer"
import * as Effect from "effect/Effect"
import { RegistryProvider } from "@effect/atom-react"
import { MemoryHistory } from "@effect-stack/router"
import { RouteDefinitionError } from "@effect-stack/router/Router"
import { make, RouterProvider, layer } from "@effect-stack/router-react"
import { Atom } from "effect/reactivity"
import * as React from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it } from "vitest"
import { App } from "./fixture/generated.tsx"
import { GateOnly } from "./fixture/project.tsx"
import { Home } from "./fixture/routes.tsx"

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

describe("generated assembly fixture", { concurrent: false }, () => {
  it("assembles individually exported parent/child modules", async () => {
    const runtime = Atom.runtime(
      layer(Effect.succeed(App)).pipe(Layer.provide(MemoryHistory.layer("/workspaces/1/projects/7")))
    )
    const { container } = mount(
      <RegistryProvider>
        <RouterProvider runtime={runtime} />
      </RegistryProvider>
    )
    expect(await waitForText(container, "Workspace")).toBe(true)
    expect(await waitForText(container, "Project 7")).toBe(true)
  })

  it("fails finalization when a selected endpoint has no presentation", () => {
    expect(Effect.runSyncExit(make("Fixture", [Home, GateOnly]))).toMatchObject({
      _tag: "Failure",
      cause: { reasons: [{ _tag: "Die", defect: expect.any(RouteDefinitionError) as unknown }] }
    })
  })
})
