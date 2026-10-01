<script setup lang="ts">
import { Provider } from "@effect-stack/router-vue"
import { Application, runtime } from "./routes.ts"
</script>

<template>
  <Provider :app="Application" :runtime="runtime" />
</template>
