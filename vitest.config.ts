import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts"],
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
