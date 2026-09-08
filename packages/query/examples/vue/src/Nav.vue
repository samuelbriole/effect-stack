<script setup lang="ts">
import * as Router from "@effect-stack/router/Router"
import { useApp } from "./app-context.ts"

const app = useApp()
</script>

<template>
  <nav class="controls">
    <button @click="app.navigate(Router.push(app.routes.users, { params: {}, search: {}, hash: '' }))">
      Users
    </button>
    <button @click="app.navigate(Router.push(app.routes.user, { params: { userId: app.sampleUserIds.ada }, search: {}, hash: '' }))">
      Ada #1
    </button>
    <button @click="app.navigate(Router.push(app.routes.user, { params: { userId: app.sampleUserIds.alan }, search: {}, hash: '' }))">
      Alan #2 (flaky report)
    </button>
    <button @click="app.navigate(Router.push(app.routes.user, { params: { userId: app.sampleUserIds.grace }, search: {}, hash: '' }))">
      Grace #3 (failing report)
    </button>
  </nav>
</template>
