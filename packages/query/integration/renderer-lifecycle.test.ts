// Core-free sanity for the renderer adapters themselves: the official Atom
// bindings must mount two observers on one registry node, propagate refreshes
// to both with the deterministic flush helpers, and release subscription
// interest on unmount. The query scenarios in react/solid/vue.test.ts build on
// exactly these mechanics.
import type * as Mutation from "@effect-stack/query/Mutation"
import { Effect, Option } from "effect"
import { Atom, AtomRegistry } from "effect/unstable/reactivity"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import { describe, expect, it } from "vitest"
import type { RendererAdapter } from "./shared/harness.ts"
import { reactRenderer, solidRenderer, vueRenderer } from "./shared/renderers.ts"

const drainImmediate = (): Promise<void> =>
  new Promise<void>((resolve) => {
    setImmediate(resolve)
  })

const runSanity = async (renderer: RendererAdapter): Promise<void> => {
  const registry = AtomRegistry.make()
  let value: AsyncResult.AsyncResult<string> = AsyncResult.initial()
  let rename: Mutation.State<string, string, never> = { latest: Option.none(), pendingCount: 0 }
  let userReads = 0
  const userAtom = Atom.readable<AsyncResult.AsyncResult<string>>(() => {
    userReads++
    return value
  })
  const renameAtom = Atom.readable<Mutation.State<string, string, never>>(() => rename)
  const view = await renderer.mount(registry, { user: userAtom, bruce: userAtom, rename: renameAtom })
  try {
    await view.flush()
    expect(view.text("user-a")).toBe("loading")
    expect(view.text("user-b")).toBe("loading")
    expect(view.text("rename")).toBe("idle")
    // Mounted hooks must observe through the registry the adapter provides.
    expect(registry.getNodes().has(userAtom)).toBe(true)
    expect(registry.getNodes().has(renameAtom)).toBe(true)
    expect(userReads).toBe(1)

    value = AsyncResult.success("Ada")
    await view.update(() => {
      registry.refresh(userAtom)
    })
    await view.settle(userAtom)
    expect(view.text("user-a")).toBe("Ada")
    expect(view.text("user-b")).toBe("Ada")
    expect(userReads).toBe(2)

    rename = {
      latest: Option.some({
        id: 0 as Mutation.InvocationId,
        input: "Grace",
        result: AsyncResult.success<string>("Grace")
      }),
      pendingCount: 0
    }
    await view.update(() => {
      registry.refresh(renameAtom)
    })
    expect(view.text("rename")).toBe("done:Grace")

    await view.unmount()
    await drainImmediate()
    expect(registry.getNodes().has(userAtom)).toBe(false)
    expect(registry.getNodes().has(renameAtom)).toBe(false)
  } finally {
    await view.unmount()
    registry.dispose()
  }
}

describe.each([reactRenderer, solidRenderer, vueRenderer])("$name adapter", (renderer) => {
  it("mounts two observers on one node, updates both on refresh, and releases interest on unmount", async () => {
    await runSanity(renderer)
  })
})

it("keeps Effect-based settling independent of renderer notification order", async () => {
  const registry = AtomRegistry.make()
  try {
    let value: AsyncResult.AsyncResult<string> = AsyncResult.initial()
    const atom = Atom.readable<AsyncResult.AsyncResult<string>>(() => value)
    const pending = Effect.runPromise(AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true }))
    value = AsyncResult.success("settled")
    registry.refresh(atom)
    expect(await pending).toBe("settled")
  } finally {
    registry.dispose()
  }
})
