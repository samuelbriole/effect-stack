# React Atom-first routing example

From the workspace root:

```sh
corepack pnpm@12.8.1 --filter @effect-stack-example/router-react exec vite
```

`routes.tsx` defines the routes, shared runtime, and project resource family. Pages use `useRouteInput` with official
`useAtomValue`, `useAtomSuspense`, and `useAtomRefresh` hooks. Project 13 fails once; **Retry resource** refreshes its atom.
The Slow route demonstrates a `prepare` gate. `navigation.tsx` imports the application type only.

See [adoption](../../../../docs/adoption.md) and [navigation contracts](../../../../docs/router-navigation.md) for ownership,
retry, and cancellation behavior.
