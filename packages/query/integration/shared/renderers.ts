// Real mounted official hooks for each renderer, without JSX transforms:
// React.createElement, Solid createComponent, and Vue h. Each adapter provides
// a private AtomRegistry through the bindings' own context mechanism and
// exposes deterministic flush helpers built on React.act, Solid's synchronous
// render effects, and Vue's nextTick.
import * as atomReact from "@effect/atom-react"
import * as atomSolid from "@effect/atom-solid"
import * as atomVue from "@effect/atom-vue"
import { Effect, Option } from "effect"
import { AtomRegistry } from "effect/unstable/reactivity"
import type * as Atom from "effect/unstable/reactivity/Atom"
import * as React from "react"
import { createRoot } from "react-dom/client"
import { createComponent, createRenderEffect } from "solid-js"
import { render } from "solid-js/web"
import { createApp, defineComponent, h, nextTick } from "vue"
import { formatResult, formatState, type RendererAdapter, type RendererView, type ScenarioSection } from "./harness.ts"

const sectionText = (container: HTMLElement, section: ScenarioSection): string =>
  container.querySelector(`[data-section="${section}"]`)?.textContent ?? "(missing)"

const immediateDrain = (): Promise<void> =>
  new Promise<void>((resolve) => {
    setImmediate(resolve)
  })

/**
 * Drains several scheduler turns so Effect runtime continuations (deferred
 * resolution -> fiber resume -> atom publish) land before assertions. This is
 * a bounded scheduler flush, not a time-based sleep; authoritative waiting is
 * done with Deferreds/Queues and `settle`.
 */
const rendererDrain = async (): Promise<void> => {
  for (let turn = 0; turn < 4; turn++) {
    // eslint-disable-next-line no-await-in-loop -- scheduler turns must land sequentially
    await immediateDrain()
  }
}

const view = (
  container: HTMLElement,
  overrides: Pick<RendererView, "flush" | "update" | "settle" | "unmount">
): RendererView => ({
  text: (section) => sectionText(container, section),
  ...overrides
})

export const reactRenderer: RendererAdapter = {
  name: "react",
  async mount(registry, atoms) {
    const previousActEnvironment = Reflect.get(globalThis, "IS_REACT_ACT_ENVIRONMENT")
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    const makeSection = <A>(section: ScenarioSection, atom: Atom.Atom<A>, format: (value: A) => string) => {
      function Section() {
        const value = atomReact.useAtomValue(atom)
        return React.createElement("span", { "data-section": section }, format(value))
      }
      return Section
    }
    const container = document.createElement("div")
    const root = createRoot(container)
    await React.act(async () => {
      root.render(
        React.createElement(
          atomReact.RegistryContext.Provider,
          { value: registry },
          React.createElement(makeSection("user-a", atoms.user, formatResult)),
          React.createElement(makeSection("user-b", atoms.user, formatResult)),
          React.createElement(makeSection("bruce", atoms.bruce, formatResult)),
          React.createElement(makeSection("rename", atoms.rename, formatState))
        )
      )
      // Mount-time atom publishes (initial/waiting states) may land after the
      // passive-effect subscriptions; drain them inside the same act cycle.
      await rendererDrain()
    })
    let unmounted = false
    return view(container, {
      flush: async () => {
        await React.act(rendererDrain)
      },
      update: async <T>(trigger: () => T | Promise<T>): Promise<Awaited<T>> => {
        let result: Option.Option<Awaited<T>> = Option.none()
        await React.act(async () => {
          result = Option.some(await trigger())
          await rendererDrain()
        })
        return Option.getOrThrow(result)
      },
      settle: async (atom) => {
        await React.act(async () => {
          await Effect.runPromise(AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true }))
          await immediateDrain()
        })
      },
      unmount: async () => {
        if (unmounted) {
          return
        }
        unmounted = true
        await React.act(async () => {
          root.unmount()
        })
        Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", previousActEnvironment)
      }
    })
  }
}

export const solidRenderer: RendererAdapter = {
  name: "solid",
  mount(registry, atoms) {
    const makeSection = <A>(section: ScenarioSection, atom: Atom.Atom<A>, format: (value: A) => string) => {
      return function Section() {
        const value = atomSolid.useAtomValue(() => atom)
        const span = document.createElement("span")
        span.dataset.section = section
        createRenderEffect(() => {
          span.textContent = format(value())
        })
        return span
      }
    }
    const container = document.createElement("div")
    const dispose = render(
      () =>
        createComponent(atomSolid.RegistryContext.Provider, {
          value: registry,
          // A getter evaluates children inside the provider's owner context,
          // just as Solid's compiled JSX does.
          get children() {
            return [
              createComponent(makeSection("user-a", atoms.user, formatResult), {}),
              createComponent(makeSection("user-b", atoms.user, formatResult), {}),
              createComponent(makeSection("bruce", atoms.bruce, formatResult), {}),
              createComponent(makeSection("rename", atoms.rename, formatState), {})
            ]
          }
        }),
      container
    )
    let unmounted = false
    return view(container, {
      flush: rendererDrain,
      update: async <T>(trigger: () => T | Promise<T>): Promise<Awaited<T>> => {
        const result = await trigger()
        await rendererDrain()
        return result
      },
      settle: async (atom) => {
        await Effect.runPromise(AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true }))
        await immediateDrain()
      },
      unmount: async () => {
        if (unmounted) {
          return
        }
        unmounted = true
        dispose()
        await immediateDrain()
      }
    })
  }
}

export const vueRenderer: RendererAdapter = {
  name: "vue",
  mount(registry, atoms) {
    const makeSection = <A>(section: ScenarioSection, atom: () => Atom.Atom<A>, format: (value: A) => string) =>
      defineComponent({
        setup() {
          const value = atomVue.useAtomValue(atom)
          return () => h("span", { "data-section": section }, format(value.value))
        }
      })
    const App = defineComponent({
      setup() {
        const sections = [
          makeSection("user-a", () => atoms.user, formatResult),
          makeSection("user-b", () => atoms.user, formatResult),
          makeSection("bruce", () => atoms.bruce, formatResult),
          makeSection("rename", () => atoms.rename, formatState)
        ]
        return () => h("div", sections.map((section) => h(section)))
      }
    })
    const container = document.createElement("div")
    const app = createApp(App)
    app.provide(atomVue.registryKey, registry)
    app.mount(container)
    let unmounted = false
    return view(container, {
      flush: async () => {
        await rendererDrain()
        await nextTick()
      },
      update: async <T>(trigger: () => T | Promise<T>): Promise<Awaited<T>> => {
        const result = await trigger()
        await rendererDrain()
        await nextTick()
        return result
      },
      settle: async (atom) => {
        await Effect.runPromise(AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true }))
        await immediateDrain()
        await nextTick()
      },
      unmount: async () => {
        if (unmounted) {
          return
        }
        unmounted = true
        app.unmount()
        await nextTick()
      }
    })
  }
}
