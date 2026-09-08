<script setup lang="ts">
import type { UserId } from "@effect-stack-example/query-shared"
import * as Router from "@effect-stack/router/Router"
import { useQueryContext } from "./query-context.ts"

const app = useQueryContext()

const goUsers = (): void => {
  app.value.navigate(Router.push(app.value.routes.users, { params: {}, search: {}, hash: "" }))
}
const goUser = (userId: UserId): void => {
  app.value.navigate(Router.push(app.value.routes.user, { params: { userId }, search: {}, hash: "" }))
}
</script>

<template>
  <nav class="controls">
    <button @click="goUsers">
      Users
    </button>
    <button @click="goUser(app.sampleUserIds.ada)">
      Ada #1
    </button>
    <button @click="goUser(app.sampleUserIds.alan)">
      Alan #2 (flaky report)
    </button>
    <button @click="goUser(app.sampleUserIds.grace)">
      Grace #3 (failing report)
    </button>
  </nav>
</template>
