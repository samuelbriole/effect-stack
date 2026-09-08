<script setup lang="ts">
import { useAtomValue } from "@effect/atom-vue"
import * as Cause from "effect/Cause"
import * as Option from "effect/Option"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import type { UserId } from "@effect-stack-example/query-shared"
import { computed } from "vue"
import { useApp } from "./app-context.ts"

const props = defineProps<{ readonly userId: UserId }>()

const app = useApp()
const result = useAtomValue(() => app.atoms.userReport(props.userId))

const view = computed<"loading" | "success" | "failure">(() => {
  const current = result.value
  if (AsyncResult.isSuccess(current)) return "success"
  if (AsyncResult.isFailure(current)) return "failure"
  return "loading"
})

const summary = computed(() => {
  const current = result.value
  return AsyncResult.isSuccess(current) ? `${current.value.summary} · activity ${current.value.activity}` : ""
})

const failureLine = computed(() => {
  const current = result.value
  if (!AsyncResult.isFailure(current)) return ""
  return Option.match(Cause.findErrorOption(current.cause), {
    onSome: (error) => error.reason,
    onNone: () => Cause.hasInterruptsOnly(current.cause) ? "Interrupted" : String(Cause.squash(current.cause))
  })
})
</script>

<template>
  <div v-if="view === 'success'" class="card" data-testid="report">
    <h4>Report</h4>
    <p>{{ summary }}</p>
  </div>
  <div v-else-if="view === 'failure'" class="card failure" data-testid="report">
    <h4>Report failed after retries</h4>
    <p>{{ failureLine }}</p>
    <p class="hint">Attempts and retries are visible in the API stats below.</p>
  </div>
  <div v-else class="card" data-testid="report">
    <p role="status">Fetching report with exponential-backoff Schedule retry…</p>
  </div>
</template>
