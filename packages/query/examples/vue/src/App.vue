<script setup lang="ts">
import type { QueryExampleApp } from "@effect-stack-example/query-shared"
import { provide } from "vue"
import { appKey } from "./app-context.ts"
import Nav from "./Nav.vue"
import RouterViewSection from "./RouterViewSection.vue"

const props = defineProps<{ readonly app: QueryExampleApp }>()
provide(appKey, props.app)
</script>

<template>
  <main>
    <p class="eyebrow">Official Atom hooks · headless core Router</p>
    <h1>EffectStack Query — Vue</h1>
    <Nav />
    <RouterViewSection />
  </main>
</template>
