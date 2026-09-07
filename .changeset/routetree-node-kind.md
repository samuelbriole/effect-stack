---
"@effect-stack/router": patch
---

Track each `RouteTree.Node`'s kind (`root`, `route`, `index`, or `layout`) in its type so renderers can resolve
destinations to the route an exact match actually ranks first. The new type parameter defaults to the previous
widened kind, so existing declarations keep compiling.

Allow index routes beneath pathless layouts to share their nearest path-bearing ancestor's URL while continuing to reject
competing index routes.
