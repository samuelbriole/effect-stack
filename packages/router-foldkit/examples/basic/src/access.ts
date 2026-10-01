import { Context, Effect, Layer, Schema } from "effect"

export class AccessDenied extends Schema.TaggedError<AccessDenied>()("AccessDenied", {
  projectId: Schema.Number
}) {}

export class Access extends Context.Service<
  Access,
  {
    readonly check: (projectId: number) => Effect.Effect<void, AccessDenied>
    readonly setAllowed: (allowed: boolean) => Effect.Effect<void>
  }
>()("example/Access") {}

// Browser session storage is this demo's authority, not the serializable Model.
// Both the router and application Commands receive this Layer-owned service.
export const AccessLive = Layer.sync(Access, () => {
  const key = "effect-stack-foldkit-project-13-access"
  return Access.of({
    check: Effect.fn("Access.check")(function* (projectId: number) {
      if (projectId === 13 && sessionStorage.getItem(key) !== "allowed") {
        return yield* Effect.fail(new AccessDenied({ projectId }))
      }
    }),
    setAllowed: Effect.fn("Access.setAllowed")((allowed: boolean) =>
      Effect.sync(() => {
        sessionStorage.setItem(key, allowed ? "allowed" : "denied")
      })
    )
  })
})
