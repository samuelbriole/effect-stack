import * as Query from "@effect-stack/query/Query"
import * as Context from "effect/Context"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import { describe, expect, test } from "tstyche"

class Repo extends Context.Service<Repo, {
  readonly fetchName: (id: number) => Effect.Effect<string>
}>()("QueryTypetest/Repo") {}

class LoadError extends Schema.TaggedError<LoadError>()("LoadError", {
  reason: Schema.String
}) {}

const tasks = Query.make({
  name: "tasks",
  load: (input: { readonly id: number; readonly page: string }) => Effect.succeed([input.id, input.page] as const)
})

const failing = Query.make({
  name: "failing",
  load: () => Effect.fail(new LoadError({ reason: "down" }))
})

const needsRepo = Query.make({
  name: "needsRepo",
  load: () => Repo.use((repo) => repo.fetchName(1))
})

const scoped = Query.make({
  name: "scoped",
  load: () => Effect.acquireRelease(Effect.succeed("resource"), () => Effect.void)
})

describe("Query.make", () => {
  test("infers input, success, error, and services from the loader", () => {
    expect<Query.Input<typeof tasks>>().type.toBe<{ readonly id: number; readonly page: string }>()
    expect<Query.Success<typeof tasks>>().type.toBe<readonly [number, string]>()
    expect<Query.Services<typeof tasks>>().type.toBe<never>()
    expect<Query.Error<typeof failing>>().type.toBe<LoadError>()
    expect<Query.Success<typeof failing>>().type.toBe<never>()
    expect<Query.Services<typeof needsRepo>>().type.toBe<Repo>()
    expect<Query.Services<typeof scoped>>().type.toBe<Scope.Scope>()
  })

  test("loader return types flow into the definition", () => {
    expect<Query.Success<typeof needsRepo>>().type.toBe<string>()
    expect<Query.Error<typeof needsRepo>>().type.toBe<never>()
  })

  test("timing options accept Duration.Input values", () => {
    expect(Query.make).type.toBeCallableWith({ name: "timed", load: () => Effect.succeed(1), staleTime: "10 seconds" })
    expect(Query.make).type.toBeCallableWith({ name: "timed", load: () => Effect.succeed(1), gcTime: 60_000 })
    expect(Query.make).type.toBeCallableWith({
      name: "timed",
      load: () => Effect.succeed(1),
      staleTime: Duration.minutes(5)
    })
    expect(Query.make).type.not.toBeCallableWith({ name: "timed", load: () => Effect.succeed(1), staleTime: "soon" })
  })

  test("options require a name and a load function", () => {
    expect(Query.make).type.not.toBeCallableWith({ load: () => Effect.succeed(1) })
    expect(Query.make).type.not.toBeCallableWith({ name: "missing-load" })
  })

  test("the loader input annotation is honored, not widened away", () => {
    const annotated = Query.make({
      name: "annotated",
      load: (input: { readonly id: number }) => Effect.succeed(input.id)
    })
    expect<Query.Input<typeof annotated>>().type.toBe<{ readonly id: number }>()
    expect<Query.Success<typeof annotated>>().type.toBe<number>()
  })
})
