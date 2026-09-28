import { lazyState } from "./lazy-state.ts"

// Evaluating this module flips the flag. It is only imported through a dynamic
// `import()` from the route definition, never eagerly.
lazyState.evaluated = true

export default function LazyPage() {
  return <p>Lazy page</p>
}
