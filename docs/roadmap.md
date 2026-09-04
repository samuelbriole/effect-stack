# Roadmap

Future packages begin with a tested tracer, not an empty package scaffold.

1. **Router hardening:** nested routes and layouts, ranking, redirects and guards, preload/cache policy, scroll
   restoration, SSR/hydration, and accessibility-focused renderer adapters.
2. **Query:** keys, request deduplication, cache and staleness, Schedule-based retry/polling, mutations, optimistic
   updates, pagination and Stream, hydration, and HttpApi/RPC integration.
3. **Form:** Schema-shaped values, touched/dirty state, synchronous and Effect validation, interruption-safe asynchronous
   validation, submission, arrays, and multi-step flows.
4. **DB:** normalized entities, indexes, STM transactions, live queries through Stream/Atom, persistence adapters, and
   explicit Query integration.

`@effect-web/router-react`, `@effect-web/router-solid`, and `@effect-web/router-vue` will appear only when accessible
links, outlets, active state, lazy views, pending/error boundaries, or SSR hydration make those packages deeper than
aliases for official Atom hooks.
