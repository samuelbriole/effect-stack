import type { QueryExampleApp } from "@effect-stack-example/query-shared"
import { inject, type InjectionKey } from "vue"

export const appKey: InjectionKey<QueryExampleApp> = Symbol("query-example/app")

export const useApp = (): QueryExampleApp => {
  const app = inject(appKey)
  if (app === undefined) {
    throw new Error("Query example components require the app provided by App.vue")
  }
  return app
}
