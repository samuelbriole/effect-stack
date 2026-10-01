import type { App } from "./app.tsx"
import { makeNavigation } from "@effect-stack/router-react"

/**
 * Typed path navigation helpers. This module imports the application type only;
 * it never imports the assembled application or any route definition module at
 * runtime. Parent and child route modules import these helpers to link across
 * routes without importing each other's definitions.
 *
 * Helpers resolve against the nearest active provider. An unbound helper cannot
 * verify that the erased application type matches the provider, so use
 * application-bound helpers when exact provider identity matters.
 *
 * @since 0.4.0
 */
export const { Link, Navigate, useNavigate } = makeNavigation<typeof App>()
