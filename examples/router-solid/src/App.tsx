import {
  destinations,
  homeRoute,
  href,
  lazyRoute,
  projectId42,
  projectRoute,
  router,
  slowRoute,
  subscribeToSlowLoader
} from "@effect-web-example/router-shared"
import * as Router from "@effect-web/router/Router"
import { useAtomSet, useAtomValue } from "@effect/atom-solid"
import * as Cause from "effect/Cause"
import { createSignal, onCleanup } from "solid-js"

export const App = () => {
  const state = useAtomValue(() => router.state)
  const navigate = useAtomSet(() => router.navigate)
  const [slowEvents, setSlowEvents] = createSignal<ReadonlyArray<string>>([])
  onCleanup(subscribeToSlowLoader((event) => setSlowEvents((current) => [...current, event])))

  const link = (command: Parameters<typeof navigate>[0]) => (event: MouseEvent) => {
    event.preventDefault()
    navigate(command)
  }

  const content = () => {
    const current = state()
    switch (current._tag) {
      case "Initial":
        return <p>Resolving the initial URL…</p>
      case "Failure":
        return <pre class="failure">{Cause.pretty(current.cause)}</pre>
      case "Success": {
        const resolved = current.value
        return (
          <section>
            <h2>{resolved.module === undefined ? resolved.id : resolved.module.title}</h2>
            {resolved.module !== undefined && <p>{resolved.module.message}</p>}
            <pre>{JSON.stringify({
              id: resolved.id,
              params: resolved.params,
              search: resolved.search,
              hash: resolved.hash,
              location: resolved.location
            }, null, 2)}</pre>
          </section>
        )
      }
    }
  }

  return (
    <main>
      <p class="eyebrow">Solid tracer · direct @effect/atom-solid integration</p>
      <h1>@effect-web/router</h1>
      <nav>
        <a href={destinations.home} onClick={link(Router.push(homeRoute, { params: {}, search: {}, hash: "" }))}>
          Home
        </a>
        <a
          href={destinations.project}
          onClick={link(Router.push(projectRoute, {
            params: { projectId: projectId42 },
            search: { tab: "activity" },
            hash: "details"
          }))}
        >
          Project 42
        </a>
        <a href={destinations.lazy} onClick={link(Router.push(lazyRoute, { params: {}, search: {}, hash: "" }))}>
          Lazy
        </a>
        <a href={destinations.slow} onClick={link(Router.push(slowRoute, { params: {}, search: {}, hash: "" }))}>
          Slow
        </a>
      </nav>
      <div class="controls">
        <button type="button" onClick={() => navigate(Router.replace(homeRoute, { params: {}, search: {}, hash: "" }))}>
          Replace with home
        </button>
        <button type="button" onClick={() => navigate(Router.back)}>Back</button>
        <button type="button" onClick={() => navigate(Router.forward)}>Forward</button>
        <button
          type="button"
          onClick={() => {
            navigate(Router.push(slowRoute, { params: {}, search: {}, hash: "" }))
            navigate(Router.push(homeRoute, { params: {}, search: {}, hash: "" }))
          }}
        >
          Interrupt slow loader
        </button>
      </div>
      <p>
        Pending: <strong>{String(state().waiting)}</strong>
      </p>
      {content()}
      <p>Slow loader lifecycle: {slowEvents().join(" → ") || "not started"}</p>
      <p>
        Generated href: <code>{href(projectRoute, { params: { projectId: projectId42 }, search: {}, hash: "" })}</code>
      </p>
      <p>
        <a href={destinations.malformed}>Open malformed URL (typed failure)</a>
      </p>
    </main>
  )
}
