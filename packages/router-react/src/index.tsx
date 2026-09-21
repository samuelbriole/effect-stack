/** First-party client-side React routing. @since 0.1.0 */

/** Augment with `interface Register { router: typeof router }`. @since 0.1.0 */
export interface Register {}

export { useRouter } from "./internal/context.ts"
export { type RouteHook, type SelectorOptions, useRouterState } from "./internal/hooks.ts"
export { Link, Navigate, type NavigationError, useNavigate, useNavigateEffect } from "./internal/navigation.tsx"
export { RouterProvider } from "./internal/provider.tsx"
export { Outlet } from "./internal/rendering.tsx"
export { createRootRoute, createRoute, type ErrorProps, type ReactRoute, type Views } from "./internal/route.ts"
export { type ClientRouter, createRouter, type Destination, type RegisteredRouter } from "./internal/router.ts"
