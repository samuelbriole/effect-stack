<script setup lang="ts">
import { useAtomValue } from "@effect/atom-vue"
import * as Effect from "effect/Effect"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import type { User, UserId } from "@effect-stack-example/query-shared"
import { computed, ref } from "vue"
import DetailObserver from "./DetailObserver.vue"
import MutationPanel from "./MutationPanel.vue"
import ReportPanel from "./ReportPanel.vue"
import StatsPanel from "./StatsPanel.vue"
import { useApp } from "./app-context.ts"

const props = defineProps<{ readonly userId: UserId; readonly user: User }>()

const app = useApp()
const newName = ref("New name")
const showReport = ref(false)

/** Fire-and-forget bridge from event handlers to environment-free Effects. */
const run = <A, E>(effect: Effect.Effect<A, E>): void => {
  Effect.runPromise(effect.pipe(Effect.asVoid)).catch(() => undefined)
}

// Live detail data; the router loader snapshot shows until it first settles.
const liveResult = useAtomValue(() => app.atoms.userDetail(props.userId))
const current = computed(() => (AsyncResult.isSuccess(liveResult.value) ? liveResult.value.value : props.user))
</script>

<template>
  <section>
    <h2 data-testid="user-heading">{{ current.name }}</h2>
    <p data-testid="user-visits">
      {{ current.visits }} visits · {{ current.email }} · live detail atom, falling back to the router loader snapshot.
    </p>
    <h3>Duplicate observers (same detail resource)</h3>
    <div class="columns">
      <DetailObserver :user-id="userId" title="Observer A" />
      <DetailObserver :user-id="userId" title="Observer B" />
    </div>
    <div class="controls">
      <button @click="run(app.actions.refreshUserDetail(userId))">Refresh detail</button>
      <input aria-label="New name" v-model="newName" />
      <button @click="run(app.actions.renameUser({ userId, name: newName }))">Rename</button>
      <button @click="run(app.actions.bumpUserVisits(userId))">Bump visits</button>
      <button @click="run(app.actions.fireOverlappingMutations({ userId, name: 'Overlapped rename' }))">
        Fire rename + bump (one each)
      </button>
      <button @click="run(app.actions.fireOverlappingRenames(userId))">Fire two renames (same mutation)</button>
      <button @click="run(app.actions.startRenameAndInterrupt(userId))">Start rename &amp; interrupt</button>
      <button @click="showReport = !showReport">
        {{ showReport ? "Hide flaky report" : "Show flaky report (Schedule retry)" }}
      </button>
    </div>
    <ReportPanel v-if="showReport" :user-id="userId" />
    <h3>Mutation state atoms</h3>
    <div class="columns">
      <MutationPanel :atom="app.atoms.renameState" id="rename" title="users/rename" />
      <MutationPanel :atom="app.atoms.bumpVisitsState" id="bump" title="users/bump-visits" />
    </div>
    <StatsPanel />
  </section>
</template>
