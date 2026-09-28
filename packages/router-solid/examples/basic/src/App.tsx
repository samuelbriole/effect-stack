import { RegistryProvider } from "@effect/atom-solid"
import { Provider } from "@effect-stack/router-solid"
import { ErrorBoundary } from "solid-js"
import { Application, runtime } from "./routes.tsx"

export const App = () => (
  <RegistryProvider>
    <ErrorBoundary fallback={(_error, reset) => <button onClick={reset}>Reset rendering</button>}>
      <Provider app={Application} runtime={runtime} pending={() => <p role="status">Preparing…</p>} />
    </ErrorBoundary>
  </RegistryProvider>
)
