# Roadmap

New domains begin with a tested end-to-end slice before becoming packages.

| Domain | Status                                                          | Next                                                                                                          |
| ------ | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Router | Contract-and-Layers routing with React, Solid, and Vue adapters | Navigation blockers, file routing, preload policy, scroll restoration, accessibility hardening                |
| Form   | Planned                                                         | Schema-shaped values, dirty/touched state, interruption-safe validation, submission, arrays, multi-step flows |
| DB     | Exploring                                                       | Normalized entities, indexes, STM transactions, Stream/Atom live queries, persistence adapters                |

Remote state uses Effect Atom, the existing Effect-native alternative to TanStack Query.
SSR/hydration, live route-resource ownership, and parallel outlets are deferred.
