import { Context, Effect, Layer } from "effect"

export class Projects extends Context.Service<Projects, {
  readonly get: (id: number) => Effect.Effect<{ readonly title: string }>
}>()("example/Projects") {}

export const demoLayer = Layer.succeed(
  Projects,
  Projects.of({
    get: Effect.fn("Projects.get")((id: number) => Effect.succeed({ title: `Project ${id} · injected service` }))
  })
)
