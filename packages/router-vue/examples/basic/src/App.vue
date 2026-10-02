<script setup lang="ts">
import { RouterProvider } from "@effect-stack/router-vue"
import { runtime } from "./routes.ts"
</script>

<template>
  <RouterProvider :runtime="runtime" />
</template>
