import { describe, expect, it } from "@effect/vitest"
import * as Context from "effect/Context"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as Atom from "effect/reactivity/Atom"
import * as AtomRegistry from "effect/reactivity/AtomRegistry"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import { AtomRouter, MemoryHistory, Router } from "@effect-stack/router"

const waitValue = <A>(registry: AtomRegistry.AtomRegistry, atom: Atom.Atom<A>, accepts: (value: A) => boolean) =>
  AtomRegistry.toStream(registry, atom).pipe(Stream.filter(accepts), Stream.runHead, Effect.map(Option.getOrThrow))

describe("application-owned Atom resources", () => {
  it.live("initial pending input does not select an incoming resource family", () =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make()
      yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()))
      const started = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const Item = Router.route("item", "/items/:id", {
        params: { id: Schema.FiniteFromString },
        prepare: () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(release)))
      })
      const App = yield* Router.make("InitialResourceInput", [Item])
      const runtime = Atom.runtime(
        Router.layer(Effect.succeed(App)).pipe(Layer.provide(MemoryHistory.layer("/items/2")))
      )
      const atoms = AtomRouter.make(runtime, App)
      const view = atoms.route(Item)
      const selections: Array<number> = []
      const family = Atom.family((id: number) => {
        selections.push(id)
        return Atom.make(`item-${id}`)
      })
      const selected = Atom.make((get) =>
        Option.match(get(view), {
          onNone: () => "no-input",
          onSome: (input) => get(family(input.params.id))
        })
      )
      const stop = registry.mount(selected)
      yield* Effect.addFinalizer(() => Effect.sync(stop))
      yield* AtomRegistry.mount(registry, atoms.service)
      const router = yield* AtomRegistry.getResult(registry, atoms.service)
      yield* Deferred.await(started)
      expect(Option.getOrThrow((yield* router.state).presentation)._tag).toBe("Pending")
      expect(Option.isNone(registry.get(view))).toBe(true)
      expect(registry.get(selected)).toBe("no-input")
      expect(selections).toEqual([])
      yield* Deferred.succeed(release, undefined)
      yield* router.awaitInitial
      expect(yield* waitValue(registry, selected, (value) => value === "item-2")).toBe("item-2")
      expect(selections).toEqual([2])
    })
  )

  it.live("a state-only observation shares services with gates and resources until registry disposal", () =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make()
      yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()))
      let acquisitions = 0
      let releases = 0
      let gateClosures = 0
      const gateIdentities: Array<object> = []
      const released = yield* Deferred.make<void>()
      class Shared extends Context.Service<Shared, { readonly identity: object }>()("test/SingleAtomRuntime") {}
      const domainLayer = Layer.effect(
        Shared,
        Effect.acquireRelease(
          Effect.sync(() => {
            acquisitions++
            return { identity: {} }
          }),
          () =>
            Effect.sync(() => {
              releases++
            }).pipe(Effect.andThen(Deferred.succeed(released, undefined)))
        )
      )
      const Home = Router.route("home", "/", {
        prepare: () =>
          Effect.gen(function* () {
            const service = yield* Shared
            gateIdentities.push(service.identity)
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                gateClosures++
              })
            )
          })
      })
      const App = yield* Router.make("SingleRuntime", [Home])
      const runtime = Atom.runtime(
        Router.layer(Effect.succeed(App)).pipe(Layer.provideMerge(Layer.merge(MemoryHistory.layer("/"), domainLayer)))
      )
      const resource = runtime.atom(Effect.map(Shared, (service) => service.identity))
      const atoms = AtomRouter.make(runtime, App)
      expect(Atom.isWritable(atoms.state)).toBe(false)
      yield* AtomRegistry.mount(registry, atoms.state)
      yield* AtomRegistry.getResult(registry, atoms.state)
      expect(registry.get(atoms.state).waiting).toBe(true)
      yield* AtomRegistry.mount(registry, resource)
      const router = yield* AtomRegistry.getResult(registry, atoms.service)
      yield* router.awaitInitial
      const identity = yield* AtomRegistry.getResult(registry, resource)
      expect(gateIdentities).toEqual([identity])
      expect(gateClosures).toBe(1)
      expect(acquisitions).toBe(1)
      expect(releases).toBe(0)
      yield* router.retry
      registry.refresh(resource)
      expect(yield* AtomRegistry.getResult(registry, resource, { suspendOnWaiting: true })).toBe(identity)
      expect(gateIdentities).toEqual([identity, identity])
      expect(gateClosures).toBe(2)
      expect(acquisitions).toBe(1)
      expect(releases).toBe(0)
      registry.dispose()
      yield* Deferred.await(released)
      expect(releases).toBe(1)
    })
  )

  it.live("the same Layer and default runtime memo map share a service within one official registry", () =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make()
      yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()))
      let acquisitions = 0
      let releases = 0
      const released = yield* Deferred.make<void>()
      class Shared extends Context.Service<Shared, { readonly identity: object }>()("test/SharedAtomLayer") {}
      const domainLayer = Layer.effect(
        Shared,
        Effect.acquireRelease(
          Effect.sync(() => {
            acquisitions++
            return { identity: {} }
          }),
          () =>
            Effect.sync(() => {
              releases++
            }).pipe(Effect.andThen(Deferred.succeed(released, undefined)))
        )
      )
      const domain = Atom.runtime(domainLayer).atom(Effect.map(Shared, (service) => service.identity))
      yield* AtomRegistry.mount(registry, domain)
      const identity = yield* AtomRegistry.getResult(registry, domain)
      let gateIdentity: object | undefined
      const Home = Router.route("home", "/", {
        prepare: () =>
          Effect.map(Shared, (service) => {
            gateIdentity = service.identity
          })
      })
      const App = yield* Router.make("SharedRegistry", [Home])
      const atoms = AtomRouter.make(
        Atom.runtime(
          Router.layer(Effect.succeed(App)).pipe(Layer.provide(domainLayer), Layer.provide(MemoryHistory.layer("/")))
        ),
        App
      )
      yield* AtomRegistry.mount(registry, atoms.service)
      const router = yield* AtomRegistry.getResult(registry, atoms.service)
      yield* router.awaitInitial
      expect(gateIdentity).toBe(identity)
      expect(acquisitions).toBe(1)
      expect(releases).toBe(0)
      registry.dispose()
      yield* Deferred.await(released)
      expect(releases).toBe(1)
    })
  )

  it.live("a single runtime keeps resource refresh and navigation retry independent", () =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make()
      yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()))
      let reads = 0
      let gates = 0
      class Projects extends Context.Service<Projects, { readonly get: Effect.Effect<number> }>()(
        "test/ResourceProjects"
      ) {}
      const domainLayer = Layer.succeed(Projects, {
        get: Effect.yieldNow.pipe(Effect.andThen(Effect.sync(() => ++reads)))
      })
      const Home = Router.route("home", "/", {
        prepare: () =>
          Effect.sync(() => {
            gates++
          })
      })
      const App = yield* Router.make("ResourceRefresh", [Home])
      const runtime = Atom.runtime(
        Router.layer(Effect.succeed(App)).pipe(Layer.provideMerge(Layer.merge(MemoryHistory.layer("/"), domainLayer)))
      )
      const resource = runtime.atom(Projects.use((projects) => projects.get))
      yield* AtomRegistry.mount(registry, resource)
      expect(yield* AtomRegistry.getResult(registry, resource)).toBe(1)
      const atoms = AtomRouter.make(runtime, App)
      yield* AtomRegistry.mount(registry, atoms.service)
      const router = yield* AtomRegistry.getResult(registry, atoms.service)
      yield* router.awaitInitial
      yield* router.retry
      expect(gates).toBe(2)
      expect(reads).toBe(1)
      registry.refresh(resource)
      expect(yield* AtomRegistry.getResult(registry, resource, { suspendOnWaiting: true })).toBe(2)
      expect((yield* router.state).status._tag).toBe("Committed")
    })
  )

  it.live("cancelling a gate cannot cancel a resource mounted on the same runtime", () =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make()
      yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()))
      const started = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const gateStarted = yield* Deferred.make<void>()
      let finalized = false
      const Home = Router.route("home", "/")
      const Blocked = Router.route("blocked", "/blocked", {
        prepare: () => Deferred.succeed(gateStarted, undefined).pipe(Effect.andThen(Effect.never))
      })
      const App = yield* Router.make("IndependentResource", [Home, Blocked])
      const runtime = Atom.runtime(Router.layer(Effect.succeed(App)).pipe(Layer.provide(MemoryHistory.layer("/"))))
      const resource = runtime.atom(
        Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Deferred.await(release)),
          Effect.as("resource"),
          Effect.ensuring(
            Effect.sync(() => {
              finalized = true
            })
          )
        )
      )
      const stop = registry.mount(resource)
      yield* Effect.addFinalizer(() => Effect.sync(stop))
      yield* Deferred.await(started)
      const atoms = AtomRouter.make(runtime, App)
      yield* AtomRegistry.mount(registry, atoms.service)
      const router = yield* AtomRegistry.getResult(registry, atoms.service)
      yield* router.awaitInitial
      const handle = yield* router.submit(Blocked.to())
      yield* Deferred.await(gateStarted)
      yield* handle.cancel
      expect(yield* handle.await).toBe("Cancelled")
      expect(finalized).toBe(false)
      yield* Deferred.succeed(release, undefined)
      expect(yield* AtomRegistry.getResult(registry, resource)).toBe("resource")
      expect(finalized).toBe(true)
    })
  )

  it.live("displayed input selects the old family until a pending parameter change commits", () =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make()
      yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()))
      const gate = yield* Deferred.make<void>()
      const gateStarted = yield* Deferred.make<void>()
      const Id = Schema.FiniteFromString.pipe(Schema.brand("ResourceId"))
      const first = yield* Schema.decodeUnknownEffect(Id)("1")
      const second = yield* Schema.decodeUnknownEffect(Id)("2")
      const Project = Router.route("project", "/projects/:id", {
        params: { id: Id },
        prepare: ({ params }) =>
          params.id === second
            ? Deferred.succeed(gateStarted, undefined).pipe(Effect.andThen(Deferred.await(gate)))
            : Effect.void
      })
      const App = yield* Router.make("CoherentInput", [Project])
      const runtime = Atom.runtime(
        Router.layer(Effect.succeed(App)).pipe(Layer.provide(MemoryHistory.layer("/projects/1")))
      )
      const atoms = AtomRouter.make(runtime, App)
      const view = atoms.route(Project)
      const family = Atom.family((id: typeof Id.Type) => runtime.atom(Effect.succeed(`project-${id}`)))
      const selected = Atom.make((get) =>
        Option.match(get(view), {
          onNone: () => AsyncResult.initial<string>(),
          onSome: (entry) => get(family(entry.params.id))
        })
      )
      const stop = registry.mount(selected)
      yield* Effect.addFinalizer(() => Effect.sync(stop))
      yield* AtomRegistry.mount(registry, atoms.service)
      const router = yield* AtomRegistry.getResult(registry, atoms.service)
      yield* router.awaitInitial
      yield* waitValue(registry, view, (value) => Option.isSome(value) && value.value.params.id === first)
      expect(yield* AtomRegistry.getResult(registry, selected)).toBe("project-1")
      const handle = yield* router.submit(Project.to({ params: { id: second } }))
      yield* Deferred.await(gateStarted)
      expect(Option.getOrThrow(registry.get(view)).params.id).toBe(first)
      expect(Option.getOrThrow((yield* router.state).location).pathname).toBe("/projects/2")
      yield* Deferred.succeed(gate, undefined)
      expect(yield* handle.await).toBe("Committed")
      yield* waitValue(registry, view, (value) => Option.isSome(value) && value.value.params.id === second)
      expect(yield* AtomRegistry.getResult(registry, selected, { suspendOnWaiting: true })).toBe("project-2")
    })
  )
})
