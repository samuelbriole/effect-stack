import type { Router } from "@effect-stack/router"
import { inject, type InjectionKey, type Ref } from "vue"
import type { RegisteredRouter, RuntimeRouter } from "./router.ts"

export const routerKey: InjectionKey<RuntimeRouter> = Symbol("effect-stack/router")
export const branchKey: InjectionKey<Readonly<Ref<Router.Branch>>> = Symbol("effect-stack/branch")
export const depthKey: InjectionKey<number> = Symbol("effect-stack/depth")
export const snapshotKey: InjectionKey<"resolved" | "incoming"> = Symbol("effect-stack/snapshot")

/** @since 0.1.0 */
export function useRouter(): RegisteredRouter {
  const router = inject(routerKey)
  if (router === undefined) throw new Error("Router hooks require RouterProvider")
  return router as RegisteredRouter
}
export const useRuntime = (): RuntimeRouter => useRouter() as RuntimeRouter
