# Roadmap

New domains begin with a tested end-to-end slice before becoming packages.

| Domain | Status                                                                                       | Next                                                                                                                                |
| ------ | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Router | Native route definitions with direct typed gates and React, Solid, Vue, and Foldkit adapters | File-based routing producer, lazy route definition acquisition, strict preload handoff, scroll restoration, accessibility hardening |
| Form   | Planned                                                                                      | Schema-shaped values, dirty/touched state, interruption-safe validation, submission, arrays, multi-step flows                       |
| DB     | Exploring                                                                                    | Normalized entities, indexes, STM transactions, Stream/Atom live queries, persistence adapters                                      |

The Foldkit router adapter targets Foldkit 0.168.0's native interfaces on stable Effect v4. Publication remains held until
Foldkit's exact Effect peer and Router's minimum Effect peer have a compatible version.

Remote state uses Effect Atom by default, the existing Effect-native alternative to TanStack Query; Foldkit applications
use their application-owned Model and Commands.
SSR/hydration, live route-resource ownership, and parallel outlets are deferred.
