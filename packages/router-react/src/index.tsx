/** First-party client-side React routing. @since 0.1.0 */
export { useRoute, useRouter, useRouterState, type RouteResult } from "./internal/hooks.ts"
export { Link, Navigate, useNavigate, useNavigateEffect, useRetry } from "./internal/navigation.tsx"
export { RouterProvider, type RouterProviderProps } from "./internal/provider.tsx"
export { DefaultError, DefaultNotFound, DefaultPending, Outlet } from "./internal/rendering.tsx"
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
