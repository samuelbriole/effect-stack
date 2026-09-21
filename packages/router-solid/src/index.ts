/** First-party client-side Solid routing. @since 0.1.0 */

/** Augment with `interface Register { router: typeof router }`. @since 0.1.0 */
export interface Register {}

export { useRouter } from "./internal/context.ts"
export { type RouteHook, type SelectorOptions, useRouterState } from "./internal/hooks.ts"
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
export { createRootRoute, createRoute, type ErrorProps, type SolidRoute, type Views } from "./internal/route.ts"
export { type ClientRouter, createRouter, type Destination, type RegisteredRouter } from "./internal/router.ts"
