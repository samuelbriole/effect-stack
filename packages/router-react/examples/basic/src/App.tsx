import { RegistryProvider } from "@effect/atom-react"
import { RouterProvider } from "@effect-stack/router-react"
import { runtime } from "./routes.tsx"

export const App = () => (
  <RegistryProvider>
    <RouterProvider runtime={runtime} />
  </RegistryProvider>
)
