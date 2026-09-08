<script setup lang="ts" generic="I">
import type { User, UserNotFound } from "@effect-stack-example/query-shared"
import { useMutation } from "@effect-stack/query-vue"
import type * as Mutation from "@effect-stack/query/Mutation"
import * as Cause from "effect/Cause"
import * as Option from "effect/Option"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import { computed } from "vue"

const props = defineProps<{
  readonly handle: Mutation.Handle<I, User, UserNotFound>
  readonly id: string
  readonly title: string
}>()

// Bind the pre-acquired controller through the adapter hook; `state` is a
// readonly ref of the controller's aggregate `Mutation.State`.
const { state } = useMutation(() => props.handle)

const pending = computed(() =>
  state.value.pendingCount === 0 ? "idle" : `${state.value.pendingCount} in flight`
)

const latestLine = computed(() => {
  const entry = Option.getOrUndefined(state.value.latest)
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
</script>

<template>
  <div class="card" :aria-label="`${title} mutation state`">
    <h4>{{ title }}</h4>
    <p :data-testid="`pending-${id}`">{{ pending }}</p>
    <p v-if="latestLine !== undefined" :data-testid="`latest-${id}`">{{ latestLine }}</p>
    <p v-else class="hint">No invocation yet.</p>
  </div>
</template>
