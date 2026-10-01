import { RegistryProvider } from "@effect/atom-react"
import { Provider } from "@effect-stack/router-react"
import { Application, runtime } from "./routes.tsx"

export const App = () => (
  <RegistryProvider>
    <Provider app={Application} runtime={runtime} />
  </RegistryProvider>
)
