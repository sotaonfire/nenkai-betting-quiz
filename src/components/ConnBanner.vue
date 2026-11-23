<script setup>
import { computed, onUnmounted, ref } from 'vue'
import { forceReconnect, lastSyncAt, offline } from '../lib/store.js'

const now = ref(Date.now())
const timer = setInterval(() => (now.value = Date.now()), 2000)
onUnmounted(() => clearInterval(timer))

// 一度は同期できていたのに、しばらくサーバーからの更新が届いていない状態も拾う
const stale = computed(
  () => lastSyncAt.value > 0 && now.value - lastSyncAt.value > 60000 && offline.value,
)
const show = computed(() => offline.value || stale.value)
const busy = ref(false)

function reload() {
  location.reload()
}

async function reconnect() {
  busy.value = true
  await forceReconnect()
  setTimeout(() => (busy.value = false), 1200)
}
</script>

<template>
  <div v-if="show" class="conn-banner">
    <span>通信が切れています。再接続を待っています…</span>
    <button class="cbtn" :disabled="busy" @click="reconnect">
      {{ busy ? '再接続中…' : '再接続' }}
    </button>
    <button class="cbtn" @click="reload">再読み込み</button>
  </div>
</template>

<style scoped>
.conn-banner {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  flex-wrap: wrap;
}
.cbtn {
  background: rgba(255, 255, 255, 0.16);
  border: 1px solid rgba(255, 255, 255, 0.3);
  color: inherit;
  border-radius: 999px;
  padding: 4px 12px;
  font-weight: 700;
  font-size: 0.85rem;
}
.cbtn:disabled {
  opacity: 0.5;
}
</style>
