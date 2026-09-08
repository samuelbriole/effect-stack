import { Context, Effect, Layer, Schema } from "effect"

export const Project = Schema.Struct({ id: Schema.Number, title: Schema.String })
export interface Project extends Schema.Schema.Type<typeof Project> {}

export class Projects extends Context.Service<Projects, {
  readonly get: (id: number) => Effect.Effect<Project>
}>()("example/Projects") {}

// This demo implementation can be replaced with an HTTP-backed Layer without
// changing route definitions or components.
export const demoLayer = Layer.succeed(
  Projects,
  Projects.of({
    get: Effect.fn("Projects.get")(function*(id: number) {
      return { id, title: `Project ${id}` }
    })
  })
)
