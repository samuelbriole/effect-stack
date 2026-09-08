import type { QueryExampleApp, User, UserId } from "@effect-stack-example/query-shared"
import type * as Mutation from "@effect-stack/query/Mutation"
import * as Router from "@effect-stack/router/Router"
import { useAtomMount, useAtomValue } from "@effect/atom-solid"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import type * as Atom from "effect/unstable/reactivity/Atom"
import { createMemo, createSignal, For, type JSX, Show } from "solid-js"

/** Fire-and-forget bridge from event handlers to environment-free Effects. */
const run = <A, E>(effect: Effect.Effect<A, E>): void => {
  Effect.runPromise(effect.pipe(Effect.asVoid)).catch(() => undefined)
}

export function App(props: { readonly app: QueryExampleApp }): JSX.Element {
  // Mounting the navigation atom keeps the headless router engine alive.
  useAtomMount(() => props.app.router.navigate)
  return (
    <main>
      <p class="eyebrow">Official Atom hooks &middot; headless core Router</p>
      <h1>EffectStack Query — Solid</h1>
      <Nav app={props.app} />
      <RouterView app={props.app} />
    </main>
  )
}

function Nav(props: { readonly app: QueryExampleApp }): JSX.Element {
  const goUsers = (): void => {
    props.app.navigate(Router.push(props.app.routes.users, { params: {}, search: {}, hash: "" }))
  }
  const goUser = (userId: UserId): void => {
    props.app.navigate(Router.push(props.app.routes.user, { params: { userId }, search: {}, hash: "" }))
  }
  return (
    <nav class="controls">
      <button onClick={goUsers}>Users</button>
      <button onClick={() => goUser(props.app.sampleUserIds.ada)}>Ada #1</button>
      <button onClick={() => goUser(props.app.sampleUserIds.alan)}>Alan #2 (flaky report)</button>
      <button onClick={() => goUser(props.app.sampleUserIds.grace)}>Grace #3 (failing report)</button>
    </nav>
  )
}

function RouterView(props: { readonly app: QueryExampleApp }): JSX.Element {
  const state = useAtomValue(() => props.app.router.state)
  const match = createMemo(() => {
    const current = state()
    return AsyncResult.isSuccess(current) ? current.value : undefined
  })
  const failure = createMemo(() => {
    const current = state()
    return AsyncResult.isFailure(current) ? current : undefined
  })
  return (
    <>
      <Show when={match()} keyed>
        {(entry) =>
          entry.id === "users"
            ? <UsersView app={props.app} users={entry.loaderData} />
            : <UserView app={props.app} userId={entry.params.userId} user={entry.loaderData} />}
      </Show>
      <Show when={failure()}>
        {(current) => (
          <section class="failure card">
            <h2>Navigation failed</h2>
            <pre>{String(Cause.squash(current().cause))}</pre>
            <button onClick={() => props.app.navigate(Router.refresh)}>Retry navigation</button>
          </section>
        )}
      </Show>
      <Show when={match() === undefined && failure() === undefined}>
        <p role="status">Loading route…</p>
      </Show>
    </>
  )
}

/** Reactive per-app mock-API counters, observed through the official Atom hook. */
function StatsPanel(props: { readonly app: QueryExampleApp }): JSX.Element {
  const stats = useAtomValue(() => props.app.atoms.stats)
  const line = createMemo(
    () =>
      `list ${stats().userList} · detail ${stats().userDetail} · report attempts ${stats().reportAttempts} (retries ${stats().reportRetries}) · mutations ${stats().mutationExecutions}`
  )
  return (
    <aside class="card" aria-label="API call stats">
      <h3>Mock API calls</h3>
      <p data-testid="api-stats">{line()}</p>
      <p class="hint">
        A reactive per-app Atom served by the mock service: dedupe and staleness keep these counts low.
      </p>
    </aside>
  )
}

function UsersView(props: { readonly app: QueryExampleApp; readonly users: ReadonlyArray<User> }): JSX.Element {
  // Live query data; the router loader snapshot shows until it first settles.
  const liveResult = useAtomValue(() => props.app.atoms.userList)
  const displayUsers = createMemo(() => {
    const current = liveResult()
    return AsyncResult.isSuccess(current) ? current.value : props.users
  })
  return (
    <section>
      <h2>Team directory</h2>
      <p>
        Rendered from the live <code>users/list</code>{" "}
        atom, falling back to the router loader snapshot until it settles. The loader closes over the same query
        resource.
      </p>
      <ul>
        <For each={displayUsers()}>
          {(user) => (
            <li>
              <UserLink app={props.app} userId={user.id} label={user.name} />{" "}
              <span>· {user.email} · {user.visits} visits</span>
            </li>
          )}
        </For>
      </ul>
      <h3>Duplicate observers (same resource)</h3>
      <p>
        Both panels below mount <code>QueryAtom.query(userList)</code>; the API is called once.
      </p>
      <div class="columns">
        <ListObserver app={props.app} title="Observer A" />
        <ListObserver app={props.app} title="Observer B" />
      </div>
      <div class="controls">
        <button onClick={() => run(props.app.actions.refreshUserList())}>Refresh list</button>
        <button
          onClick={() =>
            run(props.app.actions.invalidateUserList().pipe(Effect.andThen(props.app.resources.userList.get)))}
        >
          Invalidate + get (refetch)
        </button>
      </div>
      <StatsPanel app={props.app} />
    </section>
  )
}

function UserLink(
  props: { readonly app: QueryExampleApp; readonly userId: UserId; readonly label: string }
): JSX.Element {
  return (
    <button
      onClick={() =>
        props.app.navigate(
          Router.push(props.app.routes.user, { params: { userId: props.userId }, search: {}, hash: "" })
        )}
    >
      {props.label}
    </button>
  )
}

function ListObserver(props: { readonly app: QueryExampleApp; readonly title: string }): JSX.Element {
  const result = useAtomValue(() => props.app.atoms.userList)
  const names = createMemo(() => {
    const current = result()
    return AsyncResult.isSuccess(current) ? current.value.map((user) => user.name).join(", ") : undefined
  })
  return (
    <div class="card">
      <h4>{props.title}</h4>
      <Show when={names()} keyed>
        {(joined) => <p>{joined}</p>}
      </Show>
      <Show when={names() === undefined}>
        <p role="status">{AsyncResult.isWaiting(result()) ? "Fetching…" : "No data yet"}</p>
      </Show>
    </div>
  )
}

function UserView(props: { readonly app: QueryExampleApp; readonly userId: UserId; readonly user: User }): JSX.Element {
  const [name, setName] = createSignal("New name")
  const [showReport, setShowReport] = createSignal(false)
  // Live detail data; the router loader snapshot shows until it first settles.
  const liveResult = useAtomValue(() => props.app.atoms.userDetail(props.userId))
  const current = createMemo(() => {
    const result = liveResult()
    return AsyncResult.isSuccess(result) ? result.value : props.user
  })
  return (
    <section>
      <h2 data-testid="user-heading">{current().name}</h2>
      <p data-testid="user-visits">
        {current().visits} visits · {current().email} · live detail atom, falling back to the router loader snapshot.
      </p>
      <h3>Duplicate observers (same detail resource)</h3>
      <div class="columns">
        <DetailObserver app={props.app} userId={props.userId} title="Observer A" />
        <DetailObserver app={props.app} userId={props.userId} title="Observer B" />
      </div>
      <div class="controls">
        <button onClick={() => run(props.app.actions.refreshUserDetail(props.userId))}>Refresh detail</button>
        <input aria-label="New name" value={name()} onInput={(event) => setName(event.currentTarget.value)} />
        <button onClick={() => run(props.app.actions.renameUser({ userId: props.userId, name: name() }))}>
          Rename
        </button>
        <button onClick={() => run(props.app.actions.bumpUserVisits(props.userId))}>Bump visits</button>
        <button
          onClick={() =>
            run(props.app.actions.fireOverlappingMutations({ userId: props.userId, name: "Overlapped rename" }))}
        >
          Fire rename + bump (one each)
        </button>
        <button onClick={() => run(props.app.actions.fireOverlappingRenames(props.userId))}>
          Fire two renames (same mutation)
        </button>
        <button onClick={() => run(props.app.actions.startRenameAndInterrupt(props.userId))}>
          Start rename &amp; interrupt
        </button>
        <button onClick={() => setShowReport((value) => !value)}>
          {showReport() ? "Hide flaky report" : "Show flaky report (Schedule retry)"}
        </button>
      </div>
      <Show when={showReport()}>
        <ReportPanel app={props.app} userId={props.userId} />
      </Show>
      <h3>Mutation state atoms</h3>
      <div class="columns">
        <MutationPanel atom={props.app.atoms.renameState} id="rename" title="users/rename" />
        <MutationPanel atom={props.app.atoms.bumpVisitsState} id="bump" title="users/bump-visits" />
      </div>
      <StatsPanel app={props.app} />
    </section>
  )
}

function DetailObserver(
  props: { readonly app: QueryExampleApp; readonly userId: UserId; readonly title: string }
): JSX.Element {
  const result = useAtomValue(() => props.app.atoms.userDetail(props.userId))
  const line = createMemo(() => {
    const current = result()
    return AsyncResult.isSuccess(current) ? `${current.value.name} · ${current.value.visits} visits` : undefined
  })
  return (
    <div class="card">
      <h4>{props.title}</h4>
      <Show when={line()} keyed>
        {(text) => <p>{text}</p>}
      </Show>
      <Show when={line() === undefined}>
        <p role="status">{AsyncResult.isWaiting(result()) ? "Fetching…" : "No data yet"}</p>
      </Show>
    </div>
  )
}

function ReportPanel(props: { readonly app: QueryExampleApp; readonly userId: UserId }): JSX.Element {
  const result = useAtomValue(() => props.app.atoms.userReport(props.userId))
  const panel = createMemo(() => {
    const current = result()
    if (AsyncResult.isSuccess(current)) {
      return (
        <div class="card" data-testid="report">
          <h4>Report</h4>
          <p>{current.value.summary} · activity {current.value.activity}</p>
        </div>
      )
    }
    if (AsyncResult.isFailure(current)) {
      return (
        <div class="card failure" data-testid="report">
          <h4>Report failed after retries</h4>
          <p>
            {Option.match(Cause.findErrorOption(current.cause), {
              onSome: (error) => error.reason,
              onNone: () => Cause.hasInterruptsOnly(current.cause) ? "Interrupted" : String(Cause.squash(current.cause))
            })}
          </p>
          <p class="hint">Attempts and retries are visible in the API stats below.</p>
        </div>
      )
    }
    return (
      <div class="card" data-testid="report">
        <p role="status">Fetching report with exponential-backoff Schedule retry…</p>
      </div>
    )
  })
  return panel()
}

function MutationPanel<I>(props: {
  readonly atom: Atom.Atom<Mutation.State<I, User, unknown>>
  readonly id: string
  readonly title: string
}): JSX.Element {
  const state = useAtomValue(() => props.atom)
  const latest = createMemo(() => Option.getOrUndefined(state().latest))
  const describe = createMemo(() => {
    const entry = latest()
    if (entry === undefined) return undefined
    const result = entry.result
    const status = AsyncResult.isSuccess(result)
      ? "success"
      : AsyncResult.isFailure(result)
      ? Cause.hasInterruptsOnly(result.cause)
        ? "interrupted"
        : "failed"
      : "initial"
    return `#${entry.id} → ${status}${result.waiting ? " · waiting" : ""}`
  })
  return (
    <div class="card" aria-label={`${props.title} mutation state`}>
      <h4>{props.title}</h4>
      <p data-testid={`pending-${props.id}`}>
        {state().pendingCount === 0 ? "idle" : `${state().pendingCount} in flight`}
      </p>
      <Show when={describe()} keyed>
        {(text) => <p data-testid={`latest-${props.id}`}>{text}</p>}
      </Show>
      <Show when={describe() === undefined}>
        <p class="hint">No invocation yet.</p>
      </Show>
    </div>
  )
}
