<script setup lang="ts">
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import { useQuery } from "@effect-stack/query-vue"
import { computed } from "vue"
import { useQueryContext } from "./query-context.ts"

defineProps<{ readonly title: string }>()

const app = useQueryContext()
const result = useQuery(() => app.value.resources.userList)
const names = computed(() => {
  const current = result.value
  return AsyncResult.isSuccess(current) ? current.value.map((user) => user.name).join(", ") : undefined
})
</script>

<template>
  <div class="card">
    <h4>{{ title }}</h4>
    <p v-if="names !== undefined">{{ names }}</p>
    <p v-else role="status">{{ AsyncResult.isWaiting(result) ? "Fetching…" : "No data yet" }}</p>
  </div>
</template>
