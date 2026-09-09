import { MemoryHistory, Route, Router, RouteTree } from "@effect-stack/router"
import { describe, expect, it } from "@effect/vitest"
import { Cause, Effect, Exit, Option, Schema } from "effect"
import { AsyncResult, AtomRegistry } from "effect/unstable/reactivity"

const makeRegistry = Effect.fn("ReviewTest.makeRegistry")(function*() {
  const registry = AtomRegistry.make()
  yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()))
  return registry
})

// Runs an `execute`/`retry` effect with the concrete test registry as service.
const runRegistryEffect = <A, E>(
  registry: AtomRegistry.AtomRegistry,
  self: Effect.Effect<A, E, AtomRegistry.AtomRegistry>
): Effect.Effect<A, E> => Effect.provideService(self, AtomRegistry.AtomRegistry, registry)

class RefreshFailed extends Schema.TaggedError<RefreshFailed>()("ReviewTest.RefreshFailed", {}) {}

describe("navigation review regressions", () => {
  it.effect("publishes self-interruption as a terminal branch failure", () =>
    Effect.gen(function*() {
      const tree = RouteTree.root({ loader: () => Effect.interrupt })
      const router = Router.fromTree({ routeTree: tree, layer: MemoryHistory.layer() })
      const registry = AtomRegistry.make()
      yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()))
      yield* AtomRegistry.mount(registry, router.branch)
      yield* AtomRegistry.getResult(registry, router.state, { suspendOnWaiting: true }).pipe(Effect.exit)
      const result = registry.get(router.branch).matches[0].result
      expect(result._tag).toBe("Failure")
      if (result._tag === "Failure") expect(Cause.hasInterruptsOnly(result.cause)).toBe(true)
      expect(result.waiting).toBe(false)
    }))

  it.effect("navigation success values follow their declared void contract", () =>
    Effect.gen(function*() {
      const home = Route.make({
        id: "home",
        path: "/",
        params: {},
        search: {},
        loader: () => Effect.succeed({ greeting: "hello" })
      })
      const router = Router.make({ routes: [home], layer: MemoryHistory.layer("/") })
      const registry = yield* makeRegistry()
      yield* AtomRegistry.mount(registry, router.navigation)
      yield* AtomRegistry.mount(registry, router.branch)
      yield* AtomRegistry.mount(registry, router.state)
      // Initial publication: the leaf projection carries the resolved route,
      // while the branch operation projection is a void success.
      const leaf = yield* AtomRegistry.getResult(registry, router.state, { suspendOnWaiting: true })
      expect(leaf.id).toBe("home")
      expect(leaf.loaderData).toEqual({ greeting: "hello" })
      const initialBranch = registry.get(router.branch)
      expect(initialBranch.result._tag).toBe("Success")
      expect(AsyncResult.isSuccess(initialBranch.result) && initialBranch.result.value).toBe(undefined)
      // An execute-driven refresh settles both public operation projections
      // with `undefined`, never the resolved route object.
      yield* runRegistryEffect(registry, router.execute(Router.refresh))
      expect(
        yield* AtomRegistry.getResult(registry, router.navigation, { suspendOnWaiting: true })
      ).toBe(undefined)
      const settledBranch = registry.get(router.branch)
      expect(settledBranch.result._tag).toBe("Success")
      expect(settledBranch.result.waiting).toBe(false)
      expect(AsyncResult.isSuccess(settledBranch.result) && settledBranch.result.value).toBe(undefined)
      // The leaf and last-success snapshots keep exposing the resolved data.
      expect(AsyncResult.isSuccess(registry.get(router.state))).toBe(true)
      expect(Option.isSome(registry.get(router.completed))).toBe(true)
    }))

  it.effect("failed navigation retains a void previous success in both projections", () =>
    Effect.gen(function*() {
      let failRefresh = false
      const home = Route.make({
        id: "home",
        path: "/",
        params: {},
        search: {},
        loader: () => failRefresh ? Effect.fail(new RefreshFailed()) : Effect.succeed("ok")
      })
      const router = Router.make({ routes: [home], layer: MemoryHistory.layer("/") })
      const registry = yield* makeRegistry()
      yield* AtomRegistry.mount(registry, router.navigation)
      yield* AtomRegistry.mount(registry, router.branch)
      yield* AtomRegistry.mount(registry, router.state)
      yield* AtomRegistry.getResult(registry, router.state, { suspendOnWaiting: true })
      failRefresh = true
      const failed = yield* runRegistryEffect(registry, router.execute(Router.refresh).pipe(Effect.exit))
      expect(Exit.isFailure(failed)).toBe(true)
      // The operation projections report the failure while the retained
      // previous success follows the void contract.
      const operation = registry.get(router.navigation)
      expect(operation._tag).toBe("Failure")
      expect(operation.waiting).toBe(false)
      if (AsyncResult.isFailure(operation)) {
        expect(Option.map(operation.previousSuccess, (value) => value.value)).toEqual(Option.some(undefined))
      }
      const branchResult = registry.get(router.branch).result
      expect(branchResult._tag).toBe("Failure")
      if (AsyncResult.isFailure(branchResult)) {
        expect(Option.map(branchResult.previousSuccess, (value) => value.value)).toEqual(Option.some(undefined))
      }
      // The leaf projection keeps the resolved string data.
      const leaf = registry.get(router.state)
      expect(AsyncResult.isFailure(leaf)).toBe(true)
      if (AsyncResult.isFailure(leaf)) {
        expect(Option.map(leaf.previousSuccess, (value) => value.value.loaderData)).toEqual(Option.some("ok"))
      }
    }))
})
