import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

export default defineConfig({
  root: "packages/query-react",
  oxc: false,
  plugins: [react()],
  test: {
    environment: "node",
    include: ["test/**/*.test.{ts,tsx}"],
    sequence: { concurrent: false }
  }
})
