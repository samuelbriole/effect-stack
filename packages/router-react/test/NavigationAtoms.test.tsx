// @vitest-environment happy-dom
import { RegistryContext } from "@effect/atom-react"
import { History, MemoryHistory, Router } from "@effect-stack/router"
import { make, makeNavigation, RouterProvider, layer, route } from "@effect-stack/router-react"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Atom from "effect/reactivity/Atom"
import * as AtomRegistry from "effect/reactivity/AtomRegistry"
import * as React from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it } from "vitest"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

const mount = async (
  prepare: () => Effect.Effect<void, string> = () => Effect.void,
  startup?: Effect.Effect<void, string>
) => {
  let navigate: ReturnType<typeof Navigation.useNavigate> = () => Promise.reject(new Error("not mounted"))
  let navigateEffect: ReturnType<typeof Navigation.useNavigateEffect> = () => Effect.die(new Error("not mounted"))
  const Capture = (): React.ReactNode => {
    navigate = Navigation.useNavigate()
    navigateEffect = Navigation.useNavigateEffect()
    return null
  }
  const Home = route("home", "/", { component: Capture })
  const Slow = route("slow", "/slow", { component: Capture, prepare })
  const application = make("NativeCommands", [Home, Slow])
  const Navigation = makeNavigation<Effect.Success<typeof application>>()
  let acquisitions = 0
  const assembly = Effect.suspend(() => {
    acquisitions++
    return acquisitions > 1 && startup !== undefined ? Effect.andThen(startup, application) : application
  })
  let writes = 0
  const historyLayer = Layer.effect(
    History.History,
    Effect.map(MemoryHistory.make("/"), (history) => ({
      ...history,
      push: (destination) =>
        Effect.andThen(
          Effect.sync(() => {
            writes++
          }),
          history.push(destination)
        ),
      replace: (destination) =>
        Effect.andThen(
          Effect.sync(() => {
            writes++
          }),
          history.replace(destination)
        )
    }))
  )
  const runtime = Atom.runtime(layer(assembly).pipe(Layer.provide(historyLayer)))
  const registry = AtomRegistry.make()
  const container = document.createElement("div")
  const root = createRoot(container)
  let mounted = true
  const unmount = () => {
    if (!mounted) return
    mounted = false
    React.act(() => root.unmount())
  }
  const render = () =>
    React.act(async () => {
      root.render(
        <React.StrictMode>
          <RegistryContext.Provider value={registry}>
            <RouterProvider runtime={runtime} />
          </RegistryContext.Provider>
        </React.StrictMode>
      )
      await Effect.runPromise(AtomRegistry.getResult(registry, runtime))
    })
  await render()
  cleanups.push(() => {
    unmount()
    registry.dispose()
  })
  return {
    Home,
    Slow,
    navigate: (...args: Parameters<typeof navigate>) => navigate(...args),
    current: () => navigate,
    currentEffect: () => navigateEffect,
    writes: () => writes,
    runtime,
    render,
    unmount,
    registry,
    refresh: () => registry.refresh(runtime)
  }
}

describe("native navigation action lifetimes", { concurrent: false }, () => {
  it("settles repeated immediate commands and releases their per-call atom lifetimes", async () => {
    const fixture = await mount()
    const before = fixture.registry.getNodes().size
    await React.act(async () => {
      await expect(fixture.navigate(fixture.Home.to())).resolves.toBe("Committed")
      await expect(fixture.navigate(fixture.Home.to())).resolves.toBe("Committed")
    })
    expect(fixture.registry.getNodes().size).toBe(before)
  })

  it("keeps callbacks stable and overlapping same-hook outcomes independent", async () => {
    const started = Effect.runSync(Deferred.make<void>())
    const fixture = await mount(() => Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)))
    const callback = fixture.current()
    const first = fixture.navigate(fixture.Slow.to())
    await Effect.runPromise(Deferred.await(started))
    await fixture.render()
    expect(fixture.current()).toBe(callback)
    const second = fixture.navigate(fixture.Home.to())
    await expect(first).resolves.toBe("Superseded")
    await expect(second).resolves.toBe("Committed")
  })

  it("keeps captured navigation Effects and their callbacks usable across ordinary rerenders", async () => {
    const fixture = await mount()
    const callback = fixture.currentEffect()
    const captured = callback(fixture.Slow.to())
    await fixture.render()
    expect(fixture.currentEffect()).toBe(callback)
    await React.act(async () => {
      await expect(Effect.runPromise(captured)).resolves.toBe("Committed")
    })
    expect(fixture.writes()).toBe(1)
  })

  it("does not cancel accepted work when the caller unmounts", async () => {
    const started = Effect.runSync(Deferred.make<void>())
    const release = Effect.runSync(Deferred.make<void>())
    const fixture = await mount(() =>
      Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(release)))
    )
    const promise = fixture.navigate(fixture.Slow.to())
    await Effect.runPromise(Deferred.await(started))
    fixture.unmount()
    await Effect.runPromise(Deferred.succeed(release, undefined))
    await expect(promise).resolves.toBe("Committed")
  })

  it.each(["dispose", "reset"] as const)("rejects pending work on registry %s", async (operation) => {
    const started = Effect.runSync(Deferred.make<void>())
    const fixture = await mount(() => Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)))
    const promise = fixture.navigate(fixture.Slow.to())
    const rejected = expect(promise).rejects.toBeDefined()
    await Effect.runPromise(Deferred.await(started))
    fixture.unmount()
    await React.act(async () => {
      fixture.registry[operation]()
      await rejected
    })
  })

  it("rejects blocked runtime startup on disposal", async () => {
    const started = Effect.runSync(Deferred.make<void>())
    const fixture = await mount(undefined, Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)))
    fixture.refresh()
    const promise = fixture.navigate(fixture.Home.to())
    const rejected = expect(promise).rejects.toBeDefined()
    await Effect.runPromise(Deferred.await(started))
    fixture.unmount()
    fixture.registry.dispose()
    await rejected
  })

  it("rejects runtime startup failures", async () => {
    const release = Effect.runSync(Deferred.make<void>())
    const fixture = await mount(undefined, Deferred.await(release).pipe(Effect.andThen(Effect.fail("startup"))))
    fixture.refresh()
    const rejected = expect(fixture.navigate(fixture.Home.to())).rejects.toBe("startup")
    await React.act(async () => {
      Effect.runSync(Deferred.succeed(release, undefined))
    })
    await rejected
  })

  it("does not replay a settled command when the runtime refreshes", async () => {
    let prepares = 0
    const fixture = await mount(() =>
      Effect.sync(() => {
        prepares++
      })
    )
    await React.act(async () => {
      await expect(fixture.navigate(fixture.Slow.to())).resolves.toBe("Committed")
    })
    expect(prepares).toBe(1)
    await React.act(async () => {
      fixture.refresh()
      await fixture.render()
    })
    expect(prepares).toBe(1)
    await expect(fixture.navigate(fixture.Home.to())).resolves.toBe("Committed")
  })

  it("rejects a captured navigation Effect after fresh application acquisition without writing history", async () => {
    const fixture = await mount()
    const captured = fixture.currentEffect()(fixture.Slow.to())
    const first = await Effect.runPromise(
      AtomRegistry.getResult(fixture.registry, fixture.runtime.atom(Router.RuntimeApplication))
    )
    await React.act(async () => {
      fixture.refresh()
      await fixture.render()
    })
    const second = await Effect.runPromise(
      AtomRegistry.getResult(fixture.registry, fixture.runtime.atom(Router.RuntimeApplication))
    )
    expect(second.app.token).not.toBe(first.app.token)
    const fiber = Effect.runFork(captured)
    try {
      await Effect.runPromise(Effect.yieldNow)
      expect(fixture.writes()).toBe(0)
      expect(fiber.pollUnsafe()).toMatchObject({ _tag: "Failure" })
    } finally {
      fiber.interruptUnsafe()
    }
  })

  it("rejects a captured navigation Effect while refreshed startup retains a waiting success without writing history", async () => {
    const started = Effect.runSync(Deferred.make<void>())
    const fixture = await mount(undefined, Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)))
    const captured = fixture.currentEffect()(fixture.Slow.to())
    await React.act(async () => {
      fixture.refresh()
      await Effect.runPromise(Deferred.await(started))
    })
    expect(fixture.registry.get(fixture.runtime)).toMatchObject({ _tag: "Success", waiting: true })
    const fiber = Effect.runFork(captured)
    try {
      await Effect.runPromise(Effect.yieldNow)
      expect(fixture.writes()).toBe(0)
      expect(fiber.pollUnsafe()).toMatchObject({ _tag: "Failure" })
    } finally {
      fiber.interruptUnsafe()
    }
  })

  it("rejects commands sent to an already disposed registry", async () => {
    const fixture = await mount()
    fixture.unmount()
    fixture.registry.dispose()
    await expect(fixture.navigate(fixture.Home.to())).rejects.toBeDefined()
  })

  it("rejects invalid targets and gate failures without throwing synchronously", async () => {
    const fixture = await mount(() => Effect.fail("gate"))
    await expect(fixture.navigate(Router.route("foreign", "/missing").to() as never)).rejects.toBeDefined()
    await expect(fixture.navigate(fixture.Slow.to())).rejects.toBe("gate")
  })

  it.each(["to", "params", "search", "hash"] as const)(
    "rejects a throwing target %s getter without throwing synchronously",
    async (field) => {
      const fixture = await mount()
      const defect = new Error(`Unavailable ${field}`)
      const target = { to: "/" as const }
      Object.defineProperty(target, field, {
        get: () => {
          throw defect
        }
      })
      let result: Promise<Router.NavigationOutcome> | undefined
      expect(() => {
        result = fixture.navigate(target)
      }).not.toThrow()
      await expect(result).rejects.toBe(defect)
    }
  )
})
