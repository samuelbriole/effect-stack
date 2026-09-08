<script setup lang="ts">
import * as Effect from "effect/Effect"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import type { User, UserId } from "@effect-stack-example/query-shared"
import { useMutation, useQuery } from "@effect-stack/query-vue"
import * as Cause from "effect/Cause"
import * as Exit from "effect/Exit"
import { computed, ref } from "vue"
import DetailObserver from "./DetailObserver.vue"
import MutationPanel from "./MutationPanel.vue"
import ReportPanel from "./ReportPanel.vue"
import StatsPanel from "./StatsPanel.vue"
import { useQueryContext } from "./query-context.ts"

const props = defineProps<{ readonly userId: UserId; readonly user: User }>()

const app = useQueryContext()
const newName = ref("New name")
const showReport = ref(false)
const saveResult = ref<string | undefined>(undefined)

/** Fire-and-forget bridge from event handlers to environment-free Effects. */
const run = <A, E>(effect: Effect.Effect<A, E>): void => {
  Effect.runPromise(effect.pipe(Effect.asVoid)).catch(() => undefined)
}

// Live detail data; the router loader snapshot shows until it first settles.
const liveResult = useQuery(() => app.value.resources.userDetail(props.userId))
const current = computed(() => (AsyncResult.isSuccess(liveResult.value) ? liveResult.value.value : props.user))

// The pre-acquired controllers: awaited exits surface every outcome, including
// typed failures, instead of swallowing rejections.
const rename = useMutation(() => app.value.mutations.renameUser)
const bump = useMutation(() => app.value.mutations.bumpVisits)

const describe = (label: string, exit: Exit.Exit<User, unknown>, show: (value: User) => string): void => {
  saveResult.value = Exit.isSuccess(exit)
    ? `${label}: ${show(exit.value)}`
    : `${label} failed: ${
      Cause.hasInterruptsOnly(exit.cause)
        ? "wait interrupted; the write may still complete"
        : String(Cause.squash(exit.cause))
    }`
}

const saveRename = async (): Promise<void> => {
  const exit = await rename.executeExit({ userId: props.userId, name: newName.value })
  describe("Rename", exit, (updated) => `saved "${updated.name}"`)
}

const saveBump = async (): Promise<void> => {
  const exit = await bump.executeExit(props.userId)
  describe("Bump", exit, (updated) => `${updated.visits} visits now`)
}

const renameBusy = computed(() => rename.state.value.pendingCount > 0)
const bumpBusy = computed(() => bump.state.value.pendingCount > 0)
</script>

<template>
  <section>
    <h2 data-testid="user-heading">{{ current.name }}</h2>
    <p data-testid="user-visits">
      {{ current.visits }} visits · {{ current.email }} · live detail query, falling back to the router loader
      snapshot.
    </p>
    <h3>Duplicate observers (same detail resource)</h3>
    <div class="columns">
      <DetailObserver :user-id="userId" title="Observer A" />
      <DetailObserver :user-id="userId" title="Observer B" />
    </div>
    <div class="controls">
      <button @click="run(app.actions.refreshUserDetail(userId))">Refresh detail</button>
      <input aria-label="New name" v-model="newName" />
      <button :disabled="renameBusy" @click="saveRename">Rename</button>
      <button :disabled="bumpBusy" @click="saveBump">Bump visits</button>
      <button @click="run(app.actions.fireOverlappingMutations({ userId, name: 'Overlapped rename' }))">
        Fire rename + bump (one each)
      </button>
      <button @click="run(app.actions.fireOverlappingRenames(userId))">Fire two renames (same mutation)</button>
      <button @click="run(app.actions.startRenameAndInterrupt(userId))">Start rename &amp; interrupt</button>
      <button @click="showReport = !showReport">
        {{ showReport ? "Hide flaky report" : "Show flaky report (Schedule retry)" }}
      </button>
    </div>
    <p v-if="saveResult !== undefined" role="status" data-testid="save-result">{{ saveResult }}</p>
    <ReportPanel :user-id="userId" :enabled="showReport" />
    <h3>Mutation state</h3>
    <div class="columns">
      <MutationPanel :handle="app.mutations.renameUser" id="rename" title="users/rename" />
      <MutationPanel :handle="app.mutations.bumpVisits" id="bump" title="users/bump-visits" />
    </div>
    <StatsPanel />
  </section>
</template>
