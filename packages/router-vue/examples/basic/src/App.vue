<script setup lang="ts">
import { RouterProvider } from "@effect-stack/router-vue"
import { Routes } from "@effect-stack-example/router-shared"
import { runtime, views } from "./router.ts"
</script>

<template>
  <RouterProvider :routes="Routes" :runtime="runtime" :views="views" />
</template>
