import { make, route } from "@effect-stack/router-react"
import * as Effect from "effect/Effect"
import { Link } from "./navigation.tsx"

/**
 * A different application that reuses the first application's typed helper. The
 * helper resolves against this provider's canonical node index (nearest
 * provider semantics); the erased application type is not verified at runtime.
 *
 * @since 0.4.0
 */
export const ForeignHome = route("home", "/", {
  component: () => (
    <main>
      <h1>Foreign home</h1>
      <Link to="/projects">Projects</Link>
    </main>
  )
})

export const ForeignProjects = route("projects", "/projects", {
  component: () => <p>Foreign projects</p>
})

export const ForeignApp = await Effect.runPromise(make("ForeignNavBoundary", [ForeignHome, ForeignProjects]))
