<script setup lang="ts">
import * as Router from "@effect-stack/router/Router"
import type { UserId } from "@effect-stack-example/query-shared"
import { useQueryContext } from "./query-context.ts"

defineProps<{ readonly userId: UserId; readonly label: string }>()

const app = useQueryContext()
</script>

<template>
  <button @click="app.navigate(Router.push(app.routes.user, { params: { userId }, search: {}, hash: '' }))">
    {{ label }}
  </button>
</template>
