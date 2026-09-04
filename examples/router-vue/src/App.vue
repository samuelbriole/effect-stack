<script setup lang="ts">
import {
  destinations,
  homeRoute,
  href,
  lazyRoute,
  projectId42,
  projectRoute,
  router,
  type routes,
  slowRoute,
  subscribeToSlowLoader
} from "@effect-stack-example/router-shared"
import * as Router from "@effect-stack/router/Router"
import { useAtomSet, useAtomValue } from "@effect/atom-vue"
import * as Cause from "effect/Cause"
import { computed, onUnmounted, ref } from "vue"

const state = useAtomValue(() => router.state)
const navigate = useAtomSet(() => router.navigate)
const slowEvents = ref<ReadonlyArray<string>>([])

onUnmounted(subscribeToSlowLoader((event) => {
  slowEvents.value = [...slowEvents.value, event]
}))

const homeCommand = Router.push(homeRoute, { params: {}, search: {}, hash: "" })
const projectCommand = Router.push(projectRoute, {
  params: { projectId: projectId42 },
  search: { tab: "activity" },
  hash: "details"
})
const lazyCommand = Router.push(lazyRoute, { params: {}, search: {}, hash: "" })
const slowCommand = Router.push(slowRoute, { params: {}, search: {}, hash: "" })

const follow = (event: MouseEvent, command: Router.Command<typeof routes>): void => {
  event.preventDefault()
  navigate(command)
}

const replaceWithHome = (): void => {
  navigate(Router.replace(homeRoute, { params: {}, search: {}, hash: "" }))
}

const interruptSlowLoader = (): void => {
  navigate(slowCommand)
  navigate(homeCommand)
}

const failure = computed(() => state.value._tag === "Failure" ? Cause.pretty(state.value.cause) : undefined)
const resolved = computed(() => state.value._tag === "Success" ? state.value.value : undefined)
const title = computed(() => {
  const current = resolved.value
  return current === undefined ? undefined : current.module === undefined ? current.id : current.module.title
})
const moduleMessage = computed(() => {
  const module = resolved.value?.module
  return module === undefined ? undefined : module.message
})
const resolution = computed(() => {
  const current = resolved.value
  return current === undefined
    ? undefined
    : JSON.stringify({
      id: current.id,
      params: current.params,
      search: current.search,
      hash: current.hash,
      location: current.location
    }, null, 2)
})
</script>

<template>
  <main>
    <p class="eyebrow">Vue tracer · direct @effect/atom-vue integration</p>
    <h1>@effect-stack/router</h1>
    <nav>
      <a :href="destinations.home" @click="follow($event, homeCommand)">Home</a>
      <a :href="destinations.project" @click="follow($event, projectCommand)">Project 42</a>
      <a :href="destinations.lazy" @click="follow($event, lazyCommand)">Lazy</a>
      <a :href="destinations.slow" @click="follow($event, slowCommand)">Slow</a>
    </nav>
    <div class="controls">
      <button type="button" @click="replaceWithHome">Replace with home</button>
      <button type="button" @click="navigate(Router.back)">Back</button>
      <button type="button" @click="navigate(Router.forward)">Forward</button>
      <button type="button" @click="interruptSlowLoader">Interrupt slow loader</button>
    </div>
    <p>Pending: <strong>{{ String(state.waiting) }}</strong></p>
    <p v-if="state._tag === 'Initial'">Resolving the initial URL…</p>
    <pre v-else-if="failure !== undefined" class="failure">{{ failure }}</pre>
    <section v-else-if="resolved !== undefined">
      <h2>{{ title }}</h2>
      <p v-if="moduleMessage !== undefined">{{ moduleMessage }}</p>
      <pre>{{ resolution }}</pre>
    </section>
    <p>Slow loader lifecycle: {{ slowEvents.join(" → ") || "not started" }}</p>
    <p>
      Generated href:
      <code>{{ href(projectRoute, { params: { projectId: projectId42 }, search: {}, hash: "" }) }}</code>
    </p>
    <p><a :href="destinations.malformed">Open malformed URL (typed failure)</a></p>
  </main>
</template>
