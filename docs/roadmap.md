# Roadmap

New domains begin with a tested end-to-end slice before becoming packages.

| Domain | Status                                                    | Next                                                                                                          |
| ------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Router | Nested routing and initial React, Solid, and Vue adapters | File routing, redirects and guards, preload policy, scroll restoration, accessibility hardening               |
| Form   | Planned                                                   | Schema-shaped values, dirty/touched state, interruption-safe validation, submission, arrays, multi-step flows |
| DB     | Exploring                                                 | Normalized entities, indexes, STM transactions, Stream/Atom live queries, persistence adapters                |

Remote state uses Effect Atom, the existing Effect-native alternative to TanStack Query.
SSR/hydration and long-lived route-instance scopes are deferred.
