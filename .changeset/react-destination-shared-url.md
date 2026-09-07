---
"@effect-stack/router-react": patch
---

Harden destinations for routes sharing one URL. `Destination` now resolves each `to` path to the ranked match:
pathless layouts are no longer destinations, and a same-URL index replaces its ancestors, so the index's required
search and hash can no longer be bypassed through a weaker ancestor union member. Runtime `href`, `Link`,
`Navigate`, and `useNavigate` targets align with `RouteTree.plan` exact-match ranking instead of the last flattened
route with a matching path.
