<!--
  Vue 3. Tell the Vue compiler that tags starting with "strevokit-" are custom elements, for example in vite.config.ts:

    import vue from "@vitejs/plugin-vue";
    export default defineConfig({
      plugins: [vue({ template: { compilerOptions: { isCustomElement: (tag) => tag.startsWith("strevokit-") } } })],
    });

  Bind the join token with `.prop` so Vue sets the property: there is no token attribute.
  The page asks your own backend for a join token (see backend-token.md and ../backend-api.md).
-->
<script setup lang="ts">
import { onMounted, ref } from "vue";
import "@strevokit/shell";
import "@strevokit/shell/styles.css";
import type { MeetingShellCloseReason, MeetingShellEventMap } from "@strevokit/shell";

const props = defineProps<{ meetingId: string }>();

const token = ref<string | null>(null);
const closed = ref<MeetingShellCloseReason | null>(null);

/** A join token is single-use, so every join (including a rejoin) fetches a fresh one. */
async function join(): Promise<void> {
  closed.value = null;
  token.value = null;
  const response = await fetch(`/api/meetings/${encodeURIComponent(props.meetingId)}/join-token`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) throw new Error(`Couldn't get a join token (HTTP ${response.status}).`);
  token.value = ((await response.json()) as { token: string }).token;
}

function onJoined(event: MeetingShellEventMap["svk-joined"]): void {
  console.info("joined as", event.detail.role);
}

function onClosed(event: MeetingShellEventMap["svk-closed"]): void {
  closed.value = event.detail.reason;
}

onMounted(join);
</script>

<template>
  <main v-if="closed !== null">
    <p>The meeting has closed ({{ closed }}).</p>
    <button type="button" @click="join">Rejoin</button>
  </main>
  <main v-else-if="token !== null" class="call">
    <strevokit-meeting
      :token.prop="token"
      realtime-url="wss://realtime.example.com"
      appearance="system"
      @svk-joined="onJoined"
      @svk-closed="onClosed"
    />
  </main>
  <p v-else>Loading…</p>
</template>

<style scoped>
.call {
  height: 100dvh;
}
</style>
