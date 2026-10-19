/** First-party client-side Vue routing. @since 0.1.0 */
export { layout, route, type LayoutConstructor, type RouteConstructor } from "./internal/route.ts"
export { make, RouterProvider, type RouterProviderProps } from "./internal/application.ts"
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
} from "./internal/navigation.ts"
export { DefaultError, DefaultNotFound, DefaultPending, Outlet } from "./internal/rendering.ts"
export type {
  DirectOptions,
  EmptyOptions,
  ErrorRender,
  LinkProps,
  NavigateProps,
  NavigateTarget,
  PathTarget,
  PathTargets,
  PresentationOptions,
  RenderFn,
  ViewFailureProps
} from "./internal/route.ts"
