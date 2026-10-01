# Solid Atom-first routing example

From the workspace root:

```sh
corepack pnpm@12.8.1 --filter @effect-stack-example/router-solid exec vite
```

`routes.tsx` defines the routes, shared runtime, and project resource family. Pages use `useRouteInput` with official
`useAtomValue`, `useAtomResource`, and `useAtomRefresh` hooks. Project 13 fails once; **Retry resource** refreshes its atom.
Details demonstrate Suspense and native error recovery; the Slow route demonstrates a `prepare` gate.
`navigation.ts` imports the application type only.

See [adoption](../../../../docs/adoption.md) and [navigation contracts](../../../../docs/router-navigation.md) for ownership,
retry, and cancellation behavior.
