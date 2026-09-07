<script setup lang="ts">
import { Link, Outlet } from "@effect-stack/router-vue"
import { ref } from "vue"
import { projectRoute } from "./router.ts"

const project = projectRoute.useLoaderData()
const params = projectRoute.useParams()
const count = ref(0)
</script>

<template>
  <section>
    <h2>{{ project.title }}</h2>
    <button @click="count++">Project counter: {{ count }}</button>
    <nav>
      <Link to="/projects/:projectId" :params="params" exact>Overview</Link>
      <Link to="/projects/:projectId/details" :params="params">Details</Link>
    </nav>
    <Outlet />
  </section>
</template>
