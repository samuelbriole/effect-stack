/** First-party client-side Solid routing. @since 0.1.0 */
export { useRoute, useRouter, useRouterState, type RouteResult } from "./internal/hooks.ts"
export { Link, Navigate, useLocation, useNavigate, useNavigateEffect, useRetry } from "./internal/navigation.ts"
export { RouterProvider, type RouterProviderProps } from "./internal/provider.ts"
export { DefaultError, DefaultNotFound, DefaultPending, Outlet } from "./internal/rendering.ts"
export {
  flattenViews,
  type ErrorProps,
  type GroupView,
  type LeafView,
  type LinkDestination,
  type ViewOptions,
  type Views,
  type ViewsRecord
} from "./internal/route.ts"
