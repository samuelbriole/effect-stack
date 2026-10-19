/** First-party client-side React routing. @since 0.1.0 */
export {
  layout,
  route,
  type Layout,
  type LayoutConstructor,
  type NestedLayout,
  type Route,
  type RouteConstructor
} from "./internal/route.ts"
export { make, RouterProvider, type RouterProviderProps } from "./internal/application.tsx"
export { layer } from "@effect-stack/router/Router"
export { useRouteInput, useRouter, useRouterState } from "./internal/hooks.ts"
export {
  Link,
  Navigate,
  makeNavigation,
  useNavigate,
  useNavigateEffect,
  useRetry,
  type NavigationHelpers
} from "./internal/navigation.tsx"
export { DefaultError, DefaultNotFound, DefaultPending, Outlet } from "./internal/rendering.tsx"
export {
  type DirectOptions,
  type EmptyOptions,
  type ErrorComponent,
  type LinkProps,
  type NavigateProps,
  type NavigateTarget,
  type PathTarget,
  type PathTargets,
  type PresentationOptions,
  type ViewComponent,
  type ViewFailureProps
} from "./internal/route.ts"
