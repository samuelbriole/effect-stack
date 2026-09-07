import solid from "vite-plugin-solid"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [solid({ include: ["packages/router-solid/**/*.tsx"] })],
  test: {
    environment: "node",
    include: ["packages/*/test/**/*.test.{ts,tsx}"],
    passWithNoTests: false,
    sequence: {
      concurrent: true
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      reportsDirectory: "coverage"
    }
  }
})
