<script setup lang="ts">
import { useAtomValue } from "@effect/atom-vue"
import type * as Mutation from "@effect-stack/query/Mutation"
import * as Cause from "effect/Cause"
import * as Option from "effect/Option"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import type * as Atom from "effect/unstable/reactivity/Atom"
import type { RenameUserInput, User, UserId } from "@effect-stack-example/query-shared"
import { computed } from "vue"

const props = defineProps<{
  readonly atom: Atom.Atom<Mutation.State<RenameUserInput | UserId, User, unknown>>
  readonly id: string
  readonly title: string
}>()

const state = useAtomValue(() => props.atom)

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
