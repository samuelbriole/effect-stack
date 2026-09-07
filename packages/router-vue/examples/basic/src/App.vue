<script setup lang="ts">
import { RouterProvider } from "@effect-stack/router-vue"
import { router } from "./router.ts"
</script>

<template>
  <RouterProvider :router="router" />
</template>
