# Migrating from the previous Router API

This guide maps the previous `collect`/`bind`/`createRouter`/global `Register` API to the concise contract-and-Layers
API. It is a migration reference, not a compatibility layer.

## Contracts replace route builders and registration

Before:

```ts
const home = Route.make({ id: "home", path: "/", params: {}, search: {} })
const project = Route.make({ id: "project", path: "/projects/:projectId", ... })
const router = createRouter({ routeTree: rootRoute.addChildren([...]), layer })
declare module "@effect-stack/router-react" {
  interface Register { router: typeof router }
}
```

After:

```ts
export const Routes = Router.schema("App", {
  home: "/",
  project: { path: "/projects/:projectId", params: { projectId }, success: Project }
})
```

The collection identifier replaces the global module augmentation. `Routes.service` is the typed runtime service key;
`Routes.project(input)` constructs a typed destination.

## Implementation Layers replace loaders and binding

Previous `loader` returned navigation-scoped data through a route definition. Now a handler is an implementation Layer:

```ts
const ProjectLive = Router.route(Routes.project, ({ params }) =>
  Projects.use((projects) => projects.get(params.projectId))
)

const RouterLive = Router.layer(Routes).pipe(Layer.provide(ProjectLive), Layer.provide(BrowserHistory.layer))
```

Effectful construction runs during Layer construction:

```ts
const ProjectLive = Router.route(Routes.project).buildEffect(
  Effect.gen(function* () {
    const projects = yield* Projects
    return (input) => projects.get(input.params.projectId)
  })
)
```

## Navigation and observation

| Previous                                    | Now                                                      |
| ------------------------------------------- | -------------------------------------------------------- |
| `router.execute(Router.push(route, input))` | `router.navigate(Routes.project(input))`                 |
| `router.execute(Router.replace(...))`       | `router.navigate(destination, { replace: true })`        |
| `router.state` / `router.branch` atoms      | `router.state` effect and `router.changes` stream        |
| `router.routeAtoms(route)`                  | `AtomRouter.make(runtime, Routes).route(Routes.project)` |
| `route.useLoaderData()`                     | `useRoute(Routes.project)` (React/Solid/Vue)             |
| `createRouter({ routeTree, layer })`        | `Router.layer(Routes)` plus ordinary Layer composition   |
| `RenderPolicy` boundaries                   | View records with `component`/`pending`/`error`          |

`RouterProvider` no longer accepts a renderer-specific router object. It accepts `routes`, an application `runtime`, and
`views`, and is mounted inside the official `RegistryProvider`.

## Removed concepts

- `collect`, implementation `bind`, `withRoute`, and application-wide module augmentation.
- Public activation handles, leases, and route-resource ownership. Durable preparation output is returned directly;
  handler scopes close before publication.
- `RouteTree`, `RenderPolicy`, and the flat `Route.make` definitions. URL structure is declared once in the contract.
- Router-owned remote caches, prefetching, and view transitions; these belong to application services or Effect Atom.

See [navigation contracts](router-navigation.md) for the runtime semantics that replace the old activation model.
