import { RegistryProvider } from "@effect/atom-solid"
import { RouterProvider } from "@effect-stack/router-solid"
import { ErrorBoundary } from "solid-js"
import { runtime } from "./routes.tsx"

export const App = () => (
  <RegistryProvider>
    <ErrorBoundary fallback={(_error, reset) => <button onClick={reset}>Reset rendering</button>}>
      <RouterProvider runtime={runtime} pending={() => <p role="status">Preparing…</p>} />
    </ErrorBoundary>
  </RegistryProvider>
)
