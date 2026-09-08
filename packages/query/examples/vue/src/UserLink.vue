<script setup lang="ts">
import * as Router from "@effect-stack/router/Router"
import type { UserId } from "@effect-stack-example/query-shared"
import { useApp } from "./app-context.ts"

defineProps<{ readonly userId: UserId; readonly label: string }>()

const app = useApp()
</script>

<template>
  <button @click="app.navigate(Router.push(app.routes.user, { params: { userId }, search: {}, hash: '' }))">
    {{ label }}
  </button>
</template>
