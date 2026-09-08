import type { User, UserId, UserNotFound } from "@effect-stack-example/query-shared"
import { useMutation, useQuery } from "@effect-stack/query-solid"
import type * as Mutation from "@effect-stack/query/Mutation"
import * as Router from "@effect-stack/router/Router"
import { useAtomMount, useAtomValue } from "@effect/atom-solid"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import { createMemo, createSignal, For, type JSX, Show } from "solid-js"
import { useQueryContext } from "./query-context.ts"

/** Fire-and-forget bridge from event handlers to environment-free Effects. */
const run = <A, E>(effect: Effect.Effect<A, E>): void => {
  Effect.runPromise(effect.pipe(Effect.asVoid)).catch(() => undefined)
}

export function App(): JSX.Element {
  const app = useQueryContext()
  // Mounting the navigation atom keeps the headless router engine alive.
  useAtomMount(() => app().router.navigate)
  return (
    <main>
      <p class="eyebrow">First-party Solid adapter · headless core Router</p>
      <h1>EffectStack Query — Solid</h1>
      <Nav />
      <RouterView />
    </main>
  )
}

function Nav(): JSX.Element {
  const app = useQueryContext()
  const goUsers = (): void => {
    app().navigate(Router.push(app().routes.users, { params: {}, search: {}, hash: "" }))
  }
  const goUser = (userId: UserId): void => {
    app().navigate(Router.push(app().routes.user, { params: { userId }, search: {}, hash: "" }))
  }
  return (
    <nav class="controls">
      <button onClick={goUsers}>Users</button>
      <button onClick={() => goUser(app().sampleUserIds.ada)}>Ada #1</button>
      <button onClick={() => goUser(app().sampleUserIds.alan)}>Alan #2 (flaky report)</button>
      <button onClick={() => goUser(app().sampleUserIds.grace)}>Grace #3 (failing report)</button>
    </nav>
  )
}

function RouterView(): JSX.Element {
  const app = useQueryContext()
  const state = useAtomValue(() => app().router.state)
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
            ? <UsersView users={entry.loaderData} />
            : <UserView userId={entry.params.userId} user={entry.loaderData} />}
      </Show>
      <Show when={failure()}>
        {(current) => (
          <section class="failure card">
            <h2>Navigation failed</h2>
            <pre>{String(Cause.squash(current().cause))}</pre>
            <button onClick={() => app().navigate(Router.refresh)}>Retry navigation</button>
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
function StatsPanel(): JSX.Element {
  const app = useQueryContext()
  const stats = useAtomValue(() => app().atoms.stats)
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

function UsersView(props: { readonly users: ReadonlyArray<User> }): JSX.Element {
  const app = useQueryContext()
  // Live query data through the adapter hook; the router loader snapshot shows until it first settles.
  const liveResult = useQuery(() => app().resources.userList)
  const displayUsers = createMemo(() => {
    const current = liveResult()
    return AsyncResult.isSuccess(current) ? current.value : props.users
  })
  return (
    <section>
      <h2>Team directory</h2>
      <p>
        Rendered from the live <code>users/list</code> resource through the adapter's{" "}
        <code>useQuery</code>, falling back to the router loader snapshot until it settles. The loader closes over the
        same query resource.
      </p>
      <ul>
        <For each={displayUsers()}>
          {(user) => (
            <li>
              <UserLink userId={user.id} label={user.name} /> <span>· {user.email} · {user.visits} visits</span>
            </li>
          )}
        </For>
      </ul>
      <h3>Duplicate observers (same resource)</h3>
      <p>
        Both panels below bind <code>useQuery(() =&gt; userList)</code> on the same resource; the API is called once.
      </p>
      <div class="columns">
        <ListObserver title="Observer A" />
        <ListObserver title="Observer B" />
      </div>
      <div class="controls">
        <button onClick={() => run(app().actions.refreshUserList())}>Refresh list</button>
        <button
          onClick={() => run(app().actions.invalidateUserList().pipe(Effect.andThen(app().resources.userList.get)))}
        >
          Invalidate + get (refetch)
        </button>
      </div>
      <StatsPanel />
    </section>
  )
}

function UserLink(props: { readonly userId: UserId; readonly label: string }): JSX.Element {
  const app = useQueryContext()
  return (
    <button
      onClick={() =>
        app().navigate(
          Router.push(app().routes.user, { params: { userId: props.userId }, search: {}, hash: "" })
        )}
    >
      {props.label}
    </button>
  )
}

function ListObserver(props: { readonly title: string }): JSX.Element {
  const app = useQueryContext()
  const result = useQuery(() => app().resources.userList)
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

function UserView(props: { readonly userId: UserId; readonly user: User }): JSX.Element {
  const app = useQueryContext()
  const [name, setName] = createSignal("New name")
  const [showReport, setShowReport] = createSignal(false)
  const [saveResult, setSaveResult] = createSignal<string | undefined>(undefined)
  // Live detail data; the router loader snapshot shows until it first settles.
  const liveResult = useQuery(() => app().resources.userDetail(props.userId))
  const current = createMemo(() => {
    const result = liveResult()
    return AsyncResult.isSuccess(result) ? result.value : props.user
  })
  // The pre-acquired controllers: awaited exits surface every outcome, including
  // typed failures, instead of swallowing rejections.
  const rename = useMutation(() => app().mutations.renameUser)
  const bump = useMutation(() => app().mutations.bumpVisits)
  const describe = (label: string, exit: Exit.Exit<User, UserNotFound>, show: (value: User) => string): void => {
    setSaveResult(
      Exit.isSuccess(exit)
        ? `${label}: ${show(exit.value)}`
        : `${label} failed: ${
          Cause.hasInterruptsOnly(exit.cause)
            ? "wait interrupted; the write may still complete"
            : String(Cause.squash(exit.cause))
        }`
    )
  }
  const saveRename = (): void => {
    void rename.executeExit({ userId: props.userId, name: name() }).then((exit) => {
      describe("Rename", exit, (updated) => `saved "${updated.name}"`)
    })
  }
  const saveBump = (): void => {
    void bump.executeExit(props.userId).then((exit) => {
      describe("Bump", exit, (updated) => `${updated.visits} visits now`)
    })
  }
  return (
    <section>
      <h2 data-testid="user-heading">{current().name}</h2>
      <p data-testid="user-visits">
        {current().visits} visits · {current().email} · live detail query, falling back to the router loader snapshot.
      </p>
      <h3>Duplicate observers (same detail resource)</h3>
      <div class="columns">
        <DetailObserver userId={props.userId} title="Observer A" />
        <DetailObserver userId={props.userId} title="Observer B" />
      </div>
      <div class="controls">
        <button onClick={() => run(app().actions.refreshUserDetail(props.userId))}>Refresh detail</button>
        <input aria-label="New name" value={name()} onInput={(event) => setName(event.currentTarget.value)} />
        <button onClick={saveRename} disabled={rename.state().pendingCount > 0}>Rename</button>
        <button onClick={saveBump} disabled={bump.state().pendingCount > 0}>Bump visits</button>
        <button
          onClick={() =>
            run(app().actions.fireOverlappingMutations({ userId: props.userId, name: "Overlapped rename" }))}
        >
          Fire rename + bump (one each)
        </button>
        <button onClick={() => run(app().actions.fireOverlappingRenames(props.userId))}>
          Fire two renames (same mutation)
        </button>
        <button onClick={() => run(app().actions.startRenameAndInterrupt(props.userId))}>
          Start rename &amp; interrupt
        </button>
        <button onClick={() => setShowReport((value) => !value)}>
          {showReport() ? "Hide flaky report" : "Show flaky report (Schedule retry)"}
        </button>
      </div>
      <Show when={saveResult()} keyed>
        {(message) => <p role="status" data-testid="save-result">{message}</p>}
      </Show>
      <ReportPanel userId={props.userId} enabled={showReport()} />
      <h3>Mutation state</h3>
      <div class="columns">
        <MutationPanel getHandle={() => app().mutations.renameUser} id="rename" title="users/rename" />
        <MutationPanel getHandle={() => app().mutations.bumpVisits} id="bump" title="users/bump-visits" />
      </div>
      <StatsPanel />
    </section>
  )
}

function DetailObserver(props: { readonly userId: UserId; readonly title: string }): JSX.Element {
  const app = useQueryContext()
  const result = useQuery(() => app().resources.userDetail(props.userId))
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

function ReportPanel(props: { readonly userId: UserId; readonly enabled: boolean }): JSX.Element {
  const app = useQueryContext()
  // The dependent query hook is unconditional; while the toggle is off it binds
  // `Option.none` and reports the disabled state instead of fetching.
  const result = useQuery(() => props.enabled ? Option.some(app().resources.userReport(props.userId)) : Option.none())
  const panel = createMemo(() => {
    if (!props.enabled) {
      return (
        <div class="card" data-testid="report">
          <p role="status">Report disabled — show it to run the dependent query.</p>
        </div>
      )
    }
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
  readonly getHandle: () => Mutation.Handle<I, User, UserNotFound>
  readonly id: string
  readonly title: string
}): JSX.Element {
  const { state } = useMutation(props.getHandle)
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
