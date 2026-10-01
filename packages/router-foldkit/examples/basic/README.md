# Foldkit browser example

From the repository root after installing workspace dependencies:

```sh
corepack pnpm@12.14.0 --filter @effect-stack-example/router-foldkit dev
corepack pnpm@12.14.0 --filter @effect-stack-example/router-foldkit check
corepack pnpm@12.14.0 --filter @effect-stack-example/router-foldkit build
```

Open the Vite URL. Project 42 demonstrates a branded URL parameter, a layout/index, and a nested layout/index. The counter
is application-owned Model state. Links, Back, Forward, and browser history all use the same router connection.

Click **Lock and open Project 13** to fail the access gate. **Retry without changing access** fails again; **Allow access
and retry** changes session access in a Foldkit Command, then retries after its completion Message. `update` remains pure.
The Layer-owned access service uses browser session storage so router gates and application Commands share the same
authority; access is deliberately not stored in the Model snapshot. This is a demo, not a security boundary.

This example validates Effect and `@effect/platform-browser` 4.0.5 with Foldkit 0.168.0. Foldkit supports stable Effect 4
but declares exact 4.0.0 peers, which do not intersect Router's `^4.0.5` Effect peer. The workspace uses a narrow
patch-version exception for development and tests only; adapter publication remains held. See the [package README](../../README.md).

`src/routes.ts` explicitly executes lazy application assembly once at module bootstrap with `Effect.runSync`, outside
any running Effect. Assembly acquires no router resources; the application owns the native Foldkit runtime and supplies
the connection's resources and subscription to it.

Browser-only: no SSR or hydration. Data loading and remote resource lifetimes belong to the application, not route gates.
