import { fileURLToPath } from "node:url"
import solid from "vite-plugin-solid"
import { defineConfig } from "vitest/config"

// Renderer integration tests for @effect-stack/query.
//
// Kept as a standalone Vitest project so the root suite (environment "node",
// solid plugin scoped to packages/router-solid) stays untouched. All tests are
// plain .ts (React.createElement / Solid createComponent / Vue h), so no JSX
// transform is required; the solid plugin is registered with an include pattern
// that matches nothing here purely to inherit its pinned resolve conditions for
// the solid-js browser builds under happy-dom, mirroring the root config.
export default defineConfig({
  root: fileURLToPath(new URL("../../../", import.meta.url)),
  plugins: [solid({ include: ["packages/query/integration/**/*.solid.tsx"] })],
  test: {
    environment: "happy-dom",
    include: ["packages/query/integration/**/*.test.ts"],
    passWithNoTests: false
  }
})
