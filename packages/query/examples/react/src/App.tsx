import type { QueryExampleApp, User, UserId } from "@effect-stack-example/query-shared"
import type * as Mutation from "@effect-stack/query/Mutation"
import * as Router from "@effect-stack/router/Router"
import { useAtomMount, useAtomValue } from "@effect/atom-react"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import type * as Atom from "effect/unstable/reactivity/Atom"
import { useState } from "react"

/** Fire-and-forget bridge from event handlers to environment-free Effects. */
const run = <A, E>(effect: Effect.Effect<A, E>): void => {
  Effect.runPromise(effect.pipe(Effect.asVoid)).catch(() => undefined)
}

export function App({ app }: { readonly app: QueryExampleApp }) {
  // Mounting the navigation atom keeps the headless router engine alive.
  useAtomMount(app.router.navigate)
  return (
    <main>
      <p className="eyebrow">Official Atom hooks &middot; headless core Router</p>
      <h1>EffectStack Query — React</h1>
      <Nav app={app} />
      <RouterView app={app} />
    </main>
  )
}

function Nav({ app }: { readonly app: QueryExampleApp }) {
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

function RouterView({ app }: { readonly app: QueryExampleApp }) {
  const state = useAtomValue(app.router.state)
  if (AsyncResult.isSuccess(state)) {
    const match = state.value
    switch (match.id) {
      case "users":
        return <UsersView app={app} users={match.loaderData} />
      case "user":
        return <UserView app={app} userId={match.params.userId} user={match.loaderData} />
    }
  }
  if (AsyncResult.isFailure(state)) {
    return (
      <section className="failure card">
        <h2>Navigation failed</h2>
        <pre>{String(Cause.squash(state.cause))}</pre>
        <NavRefresh app={app} />
      </section>
    )
  }
  return <p role="status">Loading route…</p>
}

function NavRefresh({ app }: { readonly app: QueryExampleApp }) {
  return <button onClick={() => app.navigate(Router.refresh)}>Retry navigation</button>
}

function StatsPanel({ app }: { readonly app: QueryExampleApp }) {
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

function UsersView({ app, users }: { readonly app: QueryExampleApp; readonly users: ReadonlyArray<User> }) {
  // Live query data; the router loader snapshot shows until it first settles.
  const liveResult = useAtomValue(app.atoms.userList)
  const displayUsers = AsyncResult.isSuccess(liveResult) ? liveResult.value : users
  return (
    <section>
      <h2>Team directory</h2>
      <p>
        Rendered from the live <code>users/list</code>{" "}
        atom, falling back to the router loader snapshot until it settles. The loader closes over the same query
        resource.
      </p>
      <ul>
        {displayUsers.map((user) => (
          <li key={String(user.id)}>
            <UserLink app={app} userId={user.id} label={user.name} />{" "}
            <span>
              · {user.email} · {user.visits} visits
            </span>
          </li>
        ))}
      </ul>
      <h3>Duplicate observers (same resource)</h3>
      <p>
        Both panels below mount <code>QueryAtom.query(userList)</code>; the API is called once.
      </p>
      <div className="columns">
        <ListObserver app={app} title="Observer A" />
        <ListObserver app={app} title="Observer B" />
      </div>
      <div className="controls">
        <button onClick={() => run(app.actions.refreshUserList())}>Refresh list</button>
        <button
          onClick={() => run(app.actions.invalidateUserList().pipe(Effect.andThen(app.resources.userList.get)))}
        >
          Invalidate + get (refetch)
        </button>
      </div>
      <StatsPanel app={app} />
    </section>
  )
}

function UserLink({
  app,
  userId,
  label
}: {
  readonly app: QueryExampleApp
  readonly userId: UserId
  readonly label: string
}) {
  return (
    <button onClick={() => app.navigate(Router.push(app.routes.user, { params: { userId }, search: {}, hash: "" }))}>
      {label}
    </button>
  )
}

function ListObserver({ app, title }: { readonly app: QueryExampleApp; readonly title: string }) {
  const result = useAtomValue(app.atoms.userList)
  return (
    <div className="card">
      <h4>{title}</h4>
      {AsyncResult.isSuccess(result)
        ? <p>{result.value.map((user) => user.name).join(", ")}</p>
        : <p role="status">{AsyncResult.isWaiting(result) ? "Fetching…" : "No data yet"}</p>}
    </div>
  )
}

function UserView({
  app,
  userId,
  user
}: {
  readonly app: QueryExampleApp
  readonly userId: UserId
  readonly user: User
}) {
  const [name, setName] = useState("New name")
  const [showReport, setShowReport] = useState(false)
  // Live detail data; the router loader snapshot shows until it first settles.
  const liveResult = useAtomValue(app.atoms.userDetail(userId))
  const current = AsyncResult.isSuccess(liveResult) ? liveResult.value : user
  return (
    <section>
      <h2 data-testid="user-heading">{current.name}</h2>
      <p data-testid="user-visits">
        {current.visits} visits · {current.email} · live detail atom, falling back to the router loader snapshot.
      </p>
      <h3>Duplicate observers (same detail resource)</h3>
      <div className="columns">
        <DetailObserver app={app} userId={userId} title="Observer A" />
        <DetailObserver app={app} userId={userId} title="Observer B" />
      </div>
      <div className="controls">
        <button onClick={() => run(app.actions.refreshUserDetail(userId))}>Refresh detail</button>
        <input aria-label="New name" value={name} onChange={(event) => setName(event.target.value)} />
        <button onClick={() => run(app.actions.renameUser({ userId, name }))}>Rename</button>
        <button onClick={() => run(app.actions.bumpUserVisits(userId))}>Bump visits</button>
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
      {showReport ? <ReportPanel app={app} userId={userId} /> : null}
      <h3>Mutation state atoms</h3>
      <div className="columns">
        <MutationPanel atom={app.atoms.renameState} id="rename" title="users/rename" />
        <MutationPanel atom={app.atoms.bumpVisitsState} id="bump" title="users/bump-visits" />
      </div>
      <StatsPanel app={app} />
    </section>
  )
}

function DetailObserver({
  app,
  userId,
  title
}: {
  readonly app: QueryExampleApp
  readonly userId: UserId
  readonly title: string
}) {
  const result = useAtomValue(app.atoms.userDetail(userId))
  return (
    <div className="card">
      <h4>{title}</h4>
      {AsyncResult.isSuccess(result)
        ? <p>{result.value.name} · {result.value.visits} visits</p>
        : <p role="status">{AsyncResult.isWaiting(result) ? "Fetching…" : "No data yet"}</p>}
    </div>
  )
}

function ReportPanel({ app, userId }: { readonly app: QueryExampleApp; readonly userId: UserId }) {
  const result = useAtomValue(app.atoms.userReport(userId))
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
  atom,
  id,
  title
}: {
  readonly atom: Atom.Atom<Mutation.State<I, User, unknown>>
  readonly id: string
  readonly title: string
}) {
  const state = useAtomValue(atom)
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
