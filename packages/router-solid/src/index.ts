/** First-party client-side Solid routing. @since 0.1.0 */
export { layout, route, type LayoutConstructor, type RouteConstructor } from "./internal/route.ts"
export { make, RouterProvider, type RouterProviderProps } from "./internal/application.ts"
export { layer } from "@effect-stack/router/Router"
export { useRouteInput, useRouter, useRouterState } from "./internal/hooks.ts"
export {
  Link,
  Navigate,
  makeNavigation,
  useLocation,
  useNavigate,
  useNavigateEffect,
  useRetry,
  type NavigationHelpers
} from "./internal/navigation.ts"
export { DefaultError, DefaultNotFound, DefaultPending, Outlet } from "./internal/rendering.ts"
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
