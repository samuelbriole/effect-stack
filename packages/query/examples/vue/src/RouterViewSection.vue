<script setup lang="ts">
import { useAtomValue } from "@effect/atom-vue"
import * as Router from "@effect-stack/router/Router"
import * as Cause from "effect/Cause"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import { computed } from "vue"
import { useQueryContext } from "./query-context.ts"
import UsersView from "./UsersView.vue"
import UserView from "./UserView.vue"

const app = useQueryContext()
const state = useAtomValue(() => app.value.router.state)
const resolved = computed(() => (AsyncResult.isSuccess(state.value) ? state.value.value : undefined))
const failure = computed(() => (AsyncResult.isFailure(state.value) ? state.value : undefined))
const retryNavigation = (): void => {
  app.value.navigate(Router.refresh)
}
</script>

<template>
  <UsersView v-if="resolved !== undefined && resolved.id === 'users'" :users="resolved.loaderData" />
  <UserView
    v-else-if="resolved !== undefined && resolved.id === 'user'"
    :user-id="resolved.params.userId"
    :user="resolved.loaderData"
  />
  <section v-else-if="failure !== undefined" class="failure card">
    <h2>Navigation failed</h2>
    <pre>{{ String(Cause.squash(failure.cause)) }}</pre>
    <button @click="retryNavigation">Retry navigation</button>
  </section>
  <p v-else role="status">Loading route…</p>
</template>
