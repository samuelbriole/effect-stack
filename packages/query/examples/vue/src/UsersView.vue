<script setup lang="ts">
import { useAtomValue } from "@effect/atom-vue"
import * as Effect from "effect/Effect"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import type { User } from "@effect-stack-example/query-shared"
import { computed } from "vue"
import ListObserver from "./ListObserver.vue"
import StatsPanel from "./StatsPanel.vue"
import UserLink from "./UserLink.vue"
import { useApp } from "./app-context.ts"

const props = defineProps<{ readonly users: ReadonlyArray<User> }>()

const app = useApp()

/** Fire-and-forget bridge from event handlers to environment-free Effects. */
const run = <A, E>(effect: Effect.Effect<A, E>): void => {
  Effect.runPromise(effect.pipe(Effect.asVoid)).catch(() => undefined)
}

// Live query data; the router loader snapshot shows until it first settles.
const liveResult = useAtomValue(() => app.atoms.userList)
const displayUsers = computed(() =>
  AsyncResult.isSuccess(liveResult.value) ? liveResult.value.value : props.users
)
</script>

<template>
  <section>
    <h2>Team directory</h2>
    <p>
      Rendered from the live <code>users/list</code> atom, falling back to the router loader snapshot until it
      settles. The loader closes over the same query resource.
    </p>
    <ul>
      <li v-for="user in displayUsers" :key="String(user.id)">
        <UserLink :user-id="user.id" :label="user.name" /> <span>· {{ user.email }} · {{ user.visits }} visits</span>
      </li>
    </ul>
    <h3>Duplicate observers (same resource)</h3>
    <p>Both panels below mount <code>QueryAtom.query(userList)</code>; the API is called once.</p>
    <div class="columns">
      <ListObserver title="Observer A" />
      <ListObserver title="Observer B" />
    </div>
    <div class="controls">
      <button @click="run(app.actions.refreshUserList())">Refresh list</button>
      <button @click="run(app.actions.invalidateUserList().pipe(Effect.andThen(app.resources.userList.get)))">
        Invalidate + get (refetch)
      </button>
    </div>
    <StatsPanel />
  </section>
</template>
