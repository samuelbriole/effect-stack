# Foldkit browser example

From the repository root after installing workspace dependencies:

```sh
corepack pnpm@12.8.1 --filter @effect-stack-example/router-foldkit dev
corepack pnpm@12.8.1 --filter @effect-stack-example/router-foldkit check
corepack pnpm@12.8.1 --filter @effect-stack-example/router-foldkit build
```

Open the Vite URL. Project 42 demonstrates a branded URL parameter, a layout/index, and a nested layout/index. The counter
is application-owned Model state. Links, Back, Forward, and browser history all use the same router connection.

Click **Lock and open Project 13** to fail the access gate. **Retry without changing access** fails again; **Allow access
and retry** changes session access in a Foldkit Command, then retries after its completion Message. `update` remains pure.
The Layer-owned access service uses browser session storage so router gates and application Commands share the same
authority; access is deliberately not stored in the Model snapshot. This is a demo, not a security boundary.

This example uses Effect and `@effect/platform-browser` 4.0.0 with Foldkit 0.164.0 for workspace validation. That Foldkit
version still declares RC Effect peers: the workspace exception is not a promise of published stable compatibility.
The adapter release requires an aligned Foldkit peer/dependency bump. Do not copy workspace peer exceptions into a
consumer application; use the future aligned release. See the [package README](../../README.md).

Browser-only: no SSR or hydration. Data loading and remote resource lifetimes belong to the application, not route gates.
