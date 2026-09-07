# Roadmap

Future packages begin with a tested tracer, not an empty package scaffold.

1. **Router:** the core has nested routes, layouts, ranking, and Effect loaders. React, Solid, and Vue have initial
   first-party adapters. Next: file-routing tooling, redirects and guards, preload policy, scroll restoration, and further
   accessibility hardening. SSR/hydration is deferred.
2. **Query:** keys, request deduplication, cache and staleness, Schedule-based retry/polling, mutations, optimistic
   updates, pagination and Stream, hydration, and HttpApi/RPC integration.
3. **Form:** Schema-shaped values, touched/dirty state, synchronous and Effect validation, interruption-safe asynchronous
   validation, submission, arrays, and multi-step flows.
4. **DB:** normalized entities, indexes, STM transactions, live queries through Stream/Atom, persistence adapters, and
   explicit Query integration.

The React, Solid, and Vue adapters provide typed links, outlets, active state, lazy views, and route boundaries over the
same headless runtime.
