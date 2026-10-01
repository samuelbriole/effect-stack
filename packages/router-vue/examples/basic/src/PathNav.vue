<script setup lang="ts">
import * as Schema from "effect/Schema"
import { Link } from "./navigation.ts"
import { ProjectId } from "./routes.ts"

const projectId = Schema.decodeUnknownSync(ProjectId)(7)
</script>

<template>
  <Link to="/projects/:projectId" :params="{ projectId }">Project</Link>
</template>
