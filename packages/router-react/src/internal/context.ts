import * as React from "react"
import type { RegisteredRouter, RuntimeRouter } from "./router.ts"

export const RouterContext = React.createContext<RuntimeRouter | null>(null)
export const SnapshotContext = React.createContext<"resolved" | "incoming">("resolved")
export const DepthContext = React.createContext(0)

/** @since 0.1.0 */
export function useRouter(): RegisteredRouter {
  const router = React.useContext(RouterContext)
  if (router === null) throw new Error("Router hooks require RouterProvider")
  return router as RegisteredRouter
}

export function useRuntime(): RuntimeRouter {
  return useRouter() as RuntimeRouter
}
