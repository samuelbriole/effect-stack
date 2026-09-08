import type * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import * as Atom from "effect/unstable/reactivity/Atom"
import { mutationView, queryView } from "./internal/core.ts"
import type * as Mutation from "./Mutation.ts"
import type * as Query from "./Query.ts"

const queryAtoms = new WeakMap<object, Atom.Atom<AsyncResult.AsyncResult<unknown, unknown>>>()
const mutationAtoms = new WeakMap<object, Atom.Atom<Mutation.State<unknown, unknown, unknown>>>()

/**
 * A stable read-only atom over the resource's authoritative AsyncResult.
 * Mounting acquires read interest; Atom disposal relinquishes that interest.
 * The client owns retained data and asynchronous execution cleanup.
 *
 * @since 0.1.0
 * @category constructors
 */
export const query = <A, E>(resource: Query.Resource<A, E>): Atom.Atom<AsyncResult.AsyncResult<A, E>> => {
  const cached = queryAtoms.get(resource)
  if (cached !== undefined) return cached as Atom.Atom<AsyncResult.AsyncResult<A, E>>
  const view = queryView(resource)
  const atom = Atom.readable((get) => {
    const release = view.observe((value) => get.setSelf(value))
    get.addFinalizer(release)
    return view.snapshot()
  }).pipe(Atom.setIdleTTL(0))
  queryAtoms.set(resource, atom as Atom.Atom<AsyncResult.AsyncResult<unknown, unknown>>)
  return atom
}

/**
 * A stable read-only atom over a mutation controller's aggregate state.
 * Observation does not own invocation lifetime: unmounting leaves accepted
 * writes running in the client scope.
 *
 * @since 0.1.0
 * @category constructors
 */
export const mutation = <I, A, E>(handle: Mutation.Handle<I, A, E>): Atom.Atom<Mutation.State<I, A, E>> => {
  const cached = mutationAtoms.get(handle)
  if (cached !== undefined) return cached as Atom.Atom<Mutation.State<I, A, E>>
  const view = mutationView(handle)
  const atom = Atom.readable((get) => {
    const release = view.subscribe((value) => get.setSelf(value))
    get.addFinalizer(release)
    return view.snapshot()
  })
  mutationAtoms.set(handle, atom as Atom.Atom<Mutation.State<unknown, unknown, unknown>>)
  return atom
}
