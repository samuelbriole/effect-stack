/** First-party client-side Vue routing. @since 0.1.0 */
export { useRouter } from "./internal/context.ts"
export { type SelectorOptions, useRouterState, type VueRouteHook } from "./internal/hooks.ts"
export {
  Link,
  type LinkProps,
  Navigate,
  type NavigationError,
  useNavigate,
  useNavigateEffect
} from "./internal/navigation.ts"
export { RouterProvider } from "./internal/provider.ts"
export { Outlet } from "./internal/rendering.ts"
export { createRootRoute, createRoute, type ErrorProps, type Views, type VueRoute } from "./internal/route.ts"
export { type ClientRouter, createRouter, type Destination, type RegisteredRouter } from "./internal/router.ts"

/** Augment with `interface Register { router: typeof router }`. @since 0.1.0 */
export interface Register {}
