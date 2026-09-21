import { createContext, useContext } from "solid-js"
import type { RegisteredRouter, RuntimeRouter } from "./router.ts"

export const RouterContext = createContext<RuntimeRouter>()
export const SnapshotContext = createContext<"resolved" | "incoming">("resolved")
export const DepthContext = createContext(0)

/** @since 0.1.0 */
export function useRouter(): RegisteredRouter {
  const router = useContext(RouterContext)
  if (router === undefined) throw new Error("Router hooks require RouterProvider")
  return router as RegisteredRouter
}

export const useRuntime = (): RuntimeRouter => useRouter() as RuntimeRouter
