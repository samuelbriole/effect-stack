<script setup lang="ts">
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import { useQuery } from "@effect-stack/query-vue"
import type { UserId } from "@effect-stack-example/query-shared"
import { computed } from "vue"
import { useQueryContext } from "./query-context.ts"

const props = defineProps<{ readonly userId: UserId; readonly title: string }>()

const app = useQueryContext()
const result = useQuery(() => app.value.resources.userDetail(props.userId))
const line = computed(() => {
  const current = result.value
  return AsyncResult.isSuccess(current) ? `${current.value.name} · ${current.value.visits} visits` : undefined
})
</script>

<template>
  <div class="card">
    <h4>{{ title }}</h4>
    <p v-if="line !== undefined">{{ line }}</p>
    <p v-else role="status">{{ AsyncResult.isWaiting(result) ? "Fetching…" : "No data yet" }}</p>
  </div>
</template>
