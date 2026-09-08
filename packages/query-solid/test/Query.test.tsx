// @vitest-environment happy-dom
import { Query } from "@effect-stack/query"
import { createQueryContext, useQuery } from "@effect-stack/query-solid"
import { Effect, Option } from "effect"
import { createSignal, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { afterEach, describe, expect, it } from "vitest"
import { drain, format, makeClient, makeGate, mount, runCleanups } from "./shared/solid.ts"

afterEach(async () => {
  await runCleanups()
})

interface ProfileApp {
  readonly profile: (key: string) => Query.Resource<string, never>
}

interface ListApp {
  readonly list: Query.Resource<string, never>
}

interface StoreApp {
  users: Query.Resource<string, never> | Option.Option<Query.Resource<string, never>>
}

interface DerivedApp {
  key: Option.Option<string>
  resources: Record<string, Query.Resource<string, never>>
}

const Profile = createQueryContext<ProfileApp>()
const List = createQueryContext<ListApp>()
const StoreCtx = createQueryContext<StoreApp>()
const DerivedCtx = createQueryContext<DerivedApp>()

describe.sequential("useQuery", () => {
  it("treats None as inert Initial, switches leases, and rejects stale cross-resource completions", async () => {
    const gate = makeGate()
    const client = makeClient()
    const family = client.query(Query.make({ name: "profile", load: gate.load }))
    const app: ProfileApp = { profile: (key) => family(key) }
    let select!: (value: Option.Option<string>) => void

    function Observer(): JSX.Element {
      const context = Profile.useQueryContext()
      const [selected, setSelected] = createSignal<Option.Option<string>>(Option.none())
      select = setSelected
      const result = useQuery(() => Option.map(selected(), (key) => context().profile(key)))
      return <span>{format(result())}</span>
    }

    const { container } = mount(() => (
      <Profile.Provider value={app}>
        <Observer />
      </Profile.Provider>
    ))
    await drain()
    expect(container.textContent).toBe("initial")
    expect(gate.starts).toEqual({})

    select(Option.some("ada"))
    await drain()
    expect(gate.starts.ada).toBe(1)
    expect(container.textContent).toBe("initial+waiting")
    gate.release("ada")
    await drain()
    expect(container.textContent).toBe("success:ada#1")

    // Switching resources never carries the previous success across.
    select(Option.some("alan"))
    await drain()
    expect(gate.starts.alan).toBe(1)
    expect(container.textContent).toBe("initial+waiting")

    // Abandoning the pending resource releases its lease and interrupts it.
    select(Option.some("bruce"))
    await drain()
    expect(gate.interrupts.alan).toBe(1)
    expect(container.textContent).toBe("initial+waiting")
    gate.release("bruce")
    await drain()
    expect(container.textContent).toBe("success:bruce#1")

    // A late completion for the abandoned request cannot overwrite current state.
    gate.release("alan")
    await drain()
    expect(container.textContent).toBe("success:bruce#1")

    // Returning to None reports Initial again; re-selecting starts fresh work.
    select(Option.none())
    await drain()
    expect(container.textContent).toBe("initial")
    // The previous success stays visible while the refetch is in flight, and the
    // fresh attempt's own value replaces it once the new load completes.
    select(Option.some("bruce"))
    await drain()
    expect(gate.starts.bruce).toBe(2)
    expect(container.textContent).toBe("success:bruce#2")
  })

  it("shares one load between two readers and an imperative Effect read", async () => {
    const gate = makeGate()
    const client = makeClient()
    const list = client.query(Query.make({ name: "list", load: gate.load }))("all")
    const app: ListApp = { list }

    function Reader(): JSX.Element {
      const context = List.useQueryContext()
      const result = useQuery(() => context().list)
      return <span>{format(result())}</span>
    }

    const { container } = mount(() => (
      <List.Provider value={app}>
        <Reader />
        <Reader />
      </List.Provider>
    ))
    await drain()
    expect(gate.starts.all).toBe(1)

    const joined = Effect.runPromise(list.get)
    await drain()
    expect(gate.starts.all).toBe(1)

    gate.release("all")
    expect(await joined).toBe("all#1")
    await drain()
    expect(container.textContent).toBe("success:all#1success:all#1")
    expect(gate.interrupts.all).toBeUndefined()
  })

  it("releases observer leases on unmount without interrupting an imperative read", async () => {
    const gate = makeGate()
    const client = makeClient()
    const list = client.query(Query.make({ name: "list", load: gate.load }))("all")
    const app: ListApp = { list }

    function Reader(): JSX.Element {
      const result = useQuery(() => app.list)
      return <span>{format(result())}</span>
    }

    const { dispose } = mount(() => (
      <List.Provider value={app}>
        <Reader />
      </List.Provider>
    ))
    await drain()
    expect(gate.starts.all).toBe(1)

    const joined = Effect.runPromise(list.get)
    dispose()
    await drain()
    // The observers are gone, but the imperative read still holds its lease.
    expect(gate.interrupts.all).toBeUndefined()
    gate.release("all")
    expect(await joined).toBe("all#1")
  })

  it("binds resources selected directly from a native Solid store", async () => {
    const gate = makeGate()
    const client = makeClient()
    const ada = client.query(Query.make({ name: "store-ada", load: gate.load }))("ada")
    const grace = client.query(Query.make({ name: "store-grace", load: gate.load }))("grace")
    const [store, setStore] = createStore<{
      users: Query.Resource<string, never> | Option.Option<Query.Resource<string, never>>
    }>({ users: ada })

    function StoreReader(): JSX.Element {
      const context = StoreCtx.useQueryContext()
      const users = useQuery(() => context().users)
      return <span>{format(users())}</span>
    }

    const { container } = mount(() => (
      <StoreCtx.Provider value={store}>
        <StoreReader />
      </StoreCtx.Provider>
    ))
    await drain()
    expect(gate.starts.ada).toBe(1)
    gate.release("ada")
    await drain()
    expect(container.textContent).toBe("success:ada#1")

    // Path assignment of a plain object merges into the existing target by
    // Solid store contract, so whole replacement uses root bulk assignment:
    // the new resource identity publishes and tracking rebinds.
    setStore({ users: grace })
    await drain()
    expect(gate.starts.grace).toBe(1)
    expect(container.textContent).toBe("initial+waiting")
    gate.release("grace")
    await drain()
    expect(container.textContent).toBe("success:grace#1")

    // None through the store is inert: Initial without starting work.
    // Option values are opaque to store merging, so path assignment replaces.
    setStore("users", Option.none<Query.Resource<string, never>>())
    await drain()
    expect(container.textContent).toBe("initial")
    expect(gate.starts).toEqual({ ada: 1, grace: 1 })
  })

  it("normalizes resources carried inside a fresh Some built from store reads", async () => {
    const gate = makeGate()
    const client = makeClient()
    const resources = {
      ada: client.query(Query.make({ name: "derived-ada", load: gate.load }))("ada"),
      grace: client.query(Query.make({ name: "derived-grace", load: gate.load }))("grace")
    }
    const [store, setStore] = createStore<{
      key: Option.Option<string>
      resources: Record<string, Query.Resource<string, never>>
    }>({ key: Option.some("ada"), resources })

    function DerivedReader(): JSX.Element {
      const context = DerivedCtx.useQueryContext()
      const users = useQuery(() => Option.flatMap(context().key, (key) => Option.some(context().resources[key])))
      return <span>{format(users())}</span>
    }

    const { container } = mount(() => (
      <DerivedCtx.Provider value={store}>
        <DerivedReader />
      </DerivedCtx.Provider>
    ))
    await drain()
    expect(gate.starts.ada).toBe(1)
    gate.release("ada")
    await drain()
    expect(container.textContent).toBe("success:ada#1")

    setStore("key", Option.some("grace"))
    await drain()
    expect(gate.starts.grace).toBe(1)
    gate.release("grace")
    await drain()
    expect(container.textContent).toBe("success:grace#1")

    setStore("key", Option.none())
    await drain()
    expect(container.textContent).toBe("initial")
  })
})
