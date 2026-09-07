<script setup lang="ts">
import { Link, Outlet } from "@effect-stack/router-vue"
import { ref } from "vue"

const count = ref(0)
</script>

<template>
  <main>
    <p class="eyebrow">First-party Vue adapter</p>
    <h1>EffectStack Router</h1>
    <nav>
      <Link to="/" exact>Home</Link>
      <Link to="/projects/:projectId" :params="{ projectId: 42 }">Project 42</Link>
      <Link to="/projects/:projectId" :params="{ projectId: 43 }">Project 43</Link>
    </nav>
    <button @click="count++">Layout counter: {{ count }}</button>
    <Outlet />
  </main>
</template>
