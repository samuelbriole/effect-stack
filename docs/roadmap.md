# Roadmap

Future packages begin with a tested tracer, not an empty package scaffold.

1. **Router:** the core has nested routes, layouts, ranking, and Effect loaders. React, Solid, and Vue have initial
   first-party adapters. Next: file-routing tooling, redirects and guards, preload policy, scroll restoration, and further
   accessibility hardening. SSR/hydration is deferred.
2. **Query:** the initial core has scoped resource identity, shared requests, freshness and inactive retention, durable
   invalidation, concurrent observable mutations, Stream/Atom views, and native Schedule retry composition. React, Solid,
   and Vue examples share the same application runtime. Next: explicit prefetch policy, polling and platform refresh
   signals, optimistic updates, pagination, hydration, and HttpApi/RPC integration.
3. **Form:** Schema-shaped values, touched/dirty state, synchronous and Effect validation, interruption-safe asynchronous
   validation, submission, arrays, and multi-step flows.
4. **DB:** normalized entities, indexes, STM transactions, live queries through Stream/Atom, persistence adapters, and
   explicit Query integration.

The React, Solid, and Vue adapters provide typed links, outlets, active state, lazy views, and route boundaries over the
same headless runtime.
