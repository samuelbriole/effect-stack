import type { Application } from "./routes.ts"
import { makeNavigation } from "@effect-stack/router-vue"

/**
 * Typed path navigation helpers. This module imports the application type only;
 * route components use these helpers to link across routes without importing
 * route definition modules.
 *
 * @since 0.4.0
 */
export const { Link } = makeNavigation<typeof Application>()
