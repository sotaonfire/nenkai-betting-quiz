<script setup>
import { onMounted, ref } from 'vue'
import { getDoc } from 'firebase/firestore'
import { waitForAuth } from '../firebase.js'
import { configRef } from '../lib/paths.js'
import { startBaseSubscriptions, tables } from '../lib/store.js'
import { TABLE_IDS } from '../config.js'
import QrCanvas from '../components/QrCanvas.vue'

const origin = ref('')
const passphrase = ref('')
const denied = ref(false)

onMounted(async () => {
  origin.value = window.location.origin
  const user = await waitForAuth()
  if (!user) {
    denied.value = true
    return
  }
  startBaseSubscriptions()
  try {
    const snap = await getDoc(configRef('secret'))
    passphrase.value = snap.exists() ? (snap.data().passphrase ?? '') : ''
  } catch {
    denied.value = true
  }
})

function doPrint() {
  window.print()
}

const nameOf = (id) => tables.value.find((t) => t.id === id)?.name ?? `テーブル${id}`
const urlOf = (id) => `${origin.value}/?t=${id}`
</script>

<template>
  <div class="sheet">
    <div class="toolbar">
      <h2 style="margin: 0">テーブル用 QRシート</h2>
      <div class="spacer"></div>
      <button class="btn btn-primary" @click="doPrint">印刷</button>
      <a class="btn" href="/admin">管理画面へ</a>
    </div>
    <p v-if="denied" class="muted">
      合言葉を表示するには <a href="/admin">管理画面</a> で司会アカウントにログインしてください。
      （QRコード自体はこのまま印刷できます）
    </p>

    <div class="cards">
      <div v-for="id in TABLE_IDS" :key="id" class="qcard">
        <div class="ctitle">T{{ id }} ／ {{ nameOf(id) }}</div>
        <QrCanvas :text="urlOf(id)" :size="200" light />
        <div class="curl">{{ urlOf(id) }}</div>
        <div class="cpass">
          合言葉：<strong>{{ passphrase || '＿＿＿＿＿＿' }}</strong>
        </div>
        <div class="cnote">
          このテーブルの回答端末1台でスキャンしてください。<br />
          読み込むとテーブル番号は自動で選ばれます。
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sheet {
  max-width: 1000px;
  margin: 0 auto;
  padding: 20px;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
}
.cards {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 14px;
}
.qcard {
  background: #fff;
  color: #111;
  border: 2px dashed #888;
  border-radius: 12px;
  padding: 16px;
  text-align: center;
  page-break-inside: avoid;
}
.ctitle {
  font-size: 1.3rem;
  font-weight: 900;
  margin-bottom: 10px;
}
.qcard :deep(.qr) {
  margin: 0 auto;
}
.curl {
  font-size: 0.72rem;
  color: #555;
  margin-top: 8px;
  word-break: break-all;
}
.cpass {
  margin-top: 8px;
  font-size: 1.1rem;
}
.cnote {
  margin-top: 8px;
  font-size: 0.72rem;
  color: #555;
  line-height: 1.6;
}
@media print {
  .toolbar {
    display: none;
  }
  .cards {
    gap: 10px;
  }
}
</style>
