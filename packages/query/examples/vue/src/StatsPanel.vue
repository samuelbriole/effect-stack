<script setup lang="ts">
import { useAtomValue } from "@effect/atom-vue"
import { computed } from "vue"
import { useApp } from "./app-context.ts"

const app = useApp()
const stats = useAtomValue(() => app.atoms.stats)

const line = computed(
  () =>
    `list ${stats.value.userList} · detail ${stats.value.userDetail} · report attempts ${stats.value.reportAttempts} (retries ${stats.value.reportRetries}) · mutations ${stats.value.mutationExecutions}`
)
</script>

<template>
  <aside class="card" aria-label="API call stats">
    <h3>Mock API calls</h3>
    <p data-testid="api-stats">{{ line }}</p>
    <p class="hint">A reactive per-app Atom served by the mock service: dedupe and staleness keep these counts low.</p>
  </aside>
</template>
