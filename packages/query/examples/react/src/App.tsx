import type { User, UserId, UserNotFound } from "@effect-stack-example/query-shared"
import { useMutation, useQuery } from "@effect-stack/query-react"
import type * as Mutation from "@effect-stack/query/Mutation"
import * as Router from "@effect-stack/router/Router"
import { useAtomMount, useAtomValue } from "@effect/atom-react"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import { useState } from "react"
import { useQueryContext } from "./query-context.ts"

/** Fire-and-forget bridge from event handlers to environment-free Effects. */
const run = <A, E>(effect: Effect.Effect<A, E>): void => {
  Effect.runPromise(effect.pipe(Effect.asVoid)).catch(() => undefined)
}

export function App() {
  const app = useQueryContext()
  // Mounting the navigation atom keeps the headless router engine alive.
  useAtomMount(app.router.navigate)
  return (
    <main>
      <p className="eyebrow">First-party React adapter · headless core Router</p>
      <h1>EffectStack Query — React</h1>
      <Nav />
      <RouterView />
    </main>
  )
}

function Nav() {
  const app = useQueryContext()
  const goUsers = (): void => {
    app.navigate(Router.push(app.routes.users, { params: {}, search: {}, hash: "" }))
  }
  const goUser = (userId: UserId): void => {
    app.navigate(Router.push(app.routes.user, { params: { userId }, search: {}, hash: "" }))
  }
  return (
    <nav className="controls">
      <button onClick={goUsers}>Users</button>
      <button onClick={() => goUser(app.sampleUserIds.ada)}>Ada #1</button>
      <button onClick={() => goUser(app.sampleUserIds.alan)}>Alan #2 (flaky report)</button>
      <button onClick={() => goUser(app.sampleUserIds.grace)}>Grace #3 (failing report)</button>
    </nav>
  )
}

function RouterView() {
  const app = useQueryContext()
  const state = useAtomValue(app.router.state)
  if (AsyncResult.isSuccess(state)) {
    const match = state.value
    switch (match.id) {
      case "users":
        return <UsersView users={match.loaderData} />
      case "user":
        return <UserView userId={match.params.userId} user={match.loaderData} />
    }
  }
  if (AsyncResult.isFailure(state)) {
    return (
      <section className="failure card">
        <h2>Navigation failed</h2>
        <pre>{String(Cause.squash(state.cause))}</pre>
        <button onClick={() => app.navigate(Router.refresh)}>Retry navigation</button>
      </section>
    )
  }
  return <p role="status">Loading route…</p>
}

function StatsPanel() {
  const app = useQueryContext()
  const stats = useAtomValue(app.atoms.stats)
  return (
    <aside className="card" aria-label="API call stats">
      <h3>Mock API calls</h3>
      <p data-testid="api-stats">
        list {stats.userList} · detail {stats.userDetail} · report attempts {stats.reportAttempts} (retries{" "}
        {stats.reportRetries}) · mutations {stats.mutationExecutions}
      </p>
      <p className="hint">
        A reactive per-app Atom served by the mock service: dedupe and staleness keep these counts low.
      </p>
    </aside>
  )
}

function UsersView({ users }: { readonly users: ReadonlyArray<User> }) {
  const app = useQueryContext()
  // Live query data through the adapter hook; the router loader snapshot shows until it first settles.
  const liveResult = useQuery(app.resources.userList)
  const displayUsers = AsyncResult.isSuccess(liveResult) ? liveResult.value : users
  return (
    <section>
      <h2>Team directory</h2>
      <p>
        Rendered from the live <code>users/list</code> resource through the adapter's{" "}
        <code>useQuery</code>, falling back to the router loader snapshot until it settles. The loader closes over the
        same query resource.
      </p>
      <ul>
        {displayUsers.map((user) => (
          <li key={String(user.id)}>
            <UserLink userId={user.id} label={user.name} />{" "}
            <span>
              · {user.email} · {user.visits} visits
            </span>
          </li>
        ))}
      </ul>
      <h3>Duplicate observers (same resource)</h3>
      <p>
        Both panels below bind <code>useQuery(userList)</code> on the same resource; the API is called once.
      </p>
      <div className="columns">
        <ListObserver title="Observer A" />
        <ListObserver title="Observer B" />
      </div>
      <div className="controls">
        <button onClick={() => run(app.actions.refreshUserList())}>Refresh list</button>
        <button
          onClick={() => run(app.actions.invalidateUserList().pipe(Effect.andThen(app.resources.userList.get)))}
        >
          Invalidate + get (refetch)
        </button>
      </div>
      <StatsPanel />
    </section>
  )
}

function UserLink({ userId, label }: { readonly userId: UserId; readonly label: string }) {
  const app = useQueryContext()
  return (
    <button onClick={() => app.navigate(Router.push(app.routes.user, { params: { userId }, search: {}, hash: "" }))}>
      {label}
    </button>
  )
}

function ListObserver({ title }: { readonly title: string }) {
  const app = useQueryContext()
  const result = useQuery(app.resources.userList)
  return (
    <div className="card">
      <h4>{title}</h4>
      {AsyncResult.isSuccess(result)
        ? <p>{result.value.map((user) => user.name).join(", ")}</p>
        : <p role="status">{AsyncResult.isWaiting(result) ? "Fetching…" : "No data yet"}</p>}
    </div>
  )
}

function UserView({ userId, user }: { readonly userId: UserId; readonly user: User }) {
  const app = useQueryContext()
  const [name, setName] = useState("New name")
  const [showReport, setShowReport] = useState(false)
  const [saveResult, setSaveResult] = useState<string | undefined>(undefined)
  // Live detail data; the router loader snapshot shows until it first settles.
  const liveResult = useQuery(app.resources.userDetail(userId))
  const current = AsyncResult.isSuccess(liveResult) ? liveResult.value : user
  // The pre-acquired controllers: awaited exits surface every outcome, including
  // typed failures, instead of swallowing rejections.
  const rename = useMutation(app.mutations.renameUser)
  const bump = useMutation(app.mutations.bumpVisits)
  const describe = <A, E>(label: string, exit: Exit.Exit<A, E>, show: (value: A) => string): void => {
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
    void rename.executeExit({ userId, name }).then((exit) => {
      describe("Rename", exit, (updated) => `saved "${updated.name}"`)
    })
  }
  const saveBump = (): void => {
    void bump.executeExit(userId).then((exit) => {
      describe("Bump", exit, (updated) => `${updated.visits} visits now`)
    })
  }
  return (
    <section>
      <h2 data-testid="user-heading">{current.name}</h2>
      <p data-testid="user-visits">
        {current.visits} visits · {current.email} · live detail query, falling back to the router loader snapshot.
      </p>
      <h3>Duplicate observers (same detail resource)</h3>
      <div className="columns">
        <DetailObserver userId={userId} title="Observer A" />
        <DetailObserver userId={userId} title="Observer B" />
      </div>
      <div className="controls">
        <button onClick={() => run(app.actions.refreshUserDetail(userId))}>Refresh detail</button>
        <input aria-label="New name" value={name} onChange={(event) => setName(event.target.value)} />
        <button onClick={saveRename} disabled={rename.state.pendingCount > 0}>Rename</button>
        <button onClick={saveBump} disabled={bump.state.pendingCount > 0}>Bump visits</button>
        <button onClick={() => run(app.actions.fireOverlappingMutations({ userId, name: "Overlapped rename" }))}>
          Fire rename + bump (one each)
        </button>
        <button onClick={() => run(app.actions.fireOverlappingRenames(userId))}>
          Fire two renames (same mutation)
        </button>
        <button onClick={() => run(app.actions.startRenameAndInterrupt(userId))}>Start rename &amp; interrupt</button>
        <button onClick={() => setShowReport((value) => !value)}>
          {showReport ? "Hide flaky report" : "Show flaky report (Schedule retry)"}
        </button>
      </div>
      {saveResult !== undefined ? <p role="status" data-testid="save-result">{saveResult}</p> : null}
      <ReportPanel userId={userId} enabled={showReport} />
      <h3>Mutation state</h3>
      <div className="columns">
        <MutationPanel handle={app.mutations.renameUser} id="rename" title="users/rename" />
        <MutationPanel handle={app.mutations.bumpVisits} id="bump" title="users/bump-visits" />
      </div>
      <StatsPanel />
    </section>
  )
}

function DetailObserver({ userId, title }: { readonly userId: UserId; readonly title: string }) {
  const app = useQueryContext()
  const result = useQuery(app.resources.userDetail(userId))
  return (
    <div className="card">
      <h4>{title}</h4>
      {AsyncResult.isSuccess(result)
        ? <p>{result.value.name} · {result.value.visits} visits</p>
        : <p role="status">{AsyncResult.isWaiting(result) ? "Fetching…" : "No data yet"}</p>}
    </div>
  )
}

function ReportPanel({ userId, enabled }: { readonly userId: UserId; readonly enabled: boolean }) {
  const app = useQueryContext()
  // The dependent query hook is unconditional; while the toggle is off it binds
  // `Option.none` and reports the disabled state instead of fetching.
  const result = useQuery(enabled ? Option.some(app.resources.userReport(userId)) : Option.none())
  if (!enabled) {
    return (
      <div className="card" data-testid="report">
        <p role="status">Report disabled — show it to run the dependent query.</p>
      </div>
    )
  }
  if (AsyncResult.isSuccess(result)) {
    return (
      <div className="card" data-testid="report">
        <h4>Report</h4>
        <p>{result.value.summary} · activity {result.value.activity}</p>
      </div>
    )
  }
  if (AsyncResult.isFailure(result)) {
    return (
      <div className="card failure" data-testid="report">
        <h4>Report failed after retries</h4>
        <p>
          {Option.match(Cause.findErrorOption(result.cause), {
            onSome: (error) => error.reason,
            onNone: () => Cause.hasInterruptsOnly(result.cause) ? "Interrupted" : String(Cause.squash(result.cause))
          })}
        </p>
        <p className="hint">Attempts and retries are visible in the API stats below.</p>
      </div>
    )
  }
  return (
    <div className="card" data-testid="report">
      <p role="status">Fetching report with exponential-backoff Schedule retry…</p>
    </div>
  )
}

function MutationPanel<I>({
  handle,
  id,
  title
}: {
  readonly handle: Mutation.Handle<I, User, UserNotFound>
  readonly id: string
  readonly title: string
}) {
  const { state } = useMutation(handle)
  const latest = Option.getOrUndefined(state.latest)
  return (
    <div className="card" aria-label={`${title} mutation state`}>
      <h4>{title}</h4>
      <p data-testid={`pending-${id}`}>{state.pendingCount === 0 ? "idle" : `${state.pendingCount} in flight`}</p>
      {latest === undefined
        ? <p className="hint">No invocation yet.</p>
        : (
          <p data-testid={`latest-${id}`}>
            #{latest.id} → {latest.result._tag === "Success"
              ? "success"
              : latest.result._tag === "Failure"
              ? Cause.hasInterruptsOnly(latest.result.cause)
                ? "interrupted"
                : "failed"
              : "initial"}
            {latest.result.waiting ? " · waiting" : ""}
          </p>
        )}
    </div>
  )
}
