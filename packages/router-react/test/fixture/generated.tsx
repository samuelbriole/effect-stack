// Hand-written stand-in for generated assembly code. It imports individually
// exported route modules and selects them; it does not define a second URL
// contract or a separate gate registration tree.
import { make } from "@effect-stack/router-react"
import * as Effect from "effect/Effect"
import { Home } from "./routes.tsx"
import { Project } from "./project.tsx"

/** @since 0.4.0 */
export const App = await Effect.runPromise(make("Fixture", [Home, Project]))
