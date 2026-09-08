---
"@effect-stack/query": patch
---

Preserve provided-service capabilities when assigning Query clients, including clients passed through typed application
contexts. A client lacking a required service can no longer be assigned to a client type claiming that service.
