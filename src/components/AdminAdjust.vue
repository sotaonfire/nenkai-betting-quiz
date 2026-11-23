<script setup>
import { ref } from 'vue'
import { adjustCoins, bulkBonus, setAnnouncement } from '../lib/host.js'
import { RULES } from '../config.js'
import { fmt } from '../lib/util.js'

const props = defineProps({ tables: { type: Array, default: () => [] } })

const tableId = ref('')
const amount = ref(RULES.BET_STEP)
const reason = ref('')
const bonusAmount = ref(RULES.DEFAULT_BONUS)
const bonusReason = ref('復活ボーナス')
const announcement = ref(`復活ボーナス 全テーブル +${RULES.DEFAULT_BONUS}！`)
const msg = ref('')
const busy = ref(false)

async function run(fn, okMsg) {
  if (busy.value) return
  busy.value = true
  msg.value = ''
  try {
    await fn()
    msg.value = okMsg
  } catch (e) {
    msg.value = `エラー: ${e.message}`
  } finally {
    busy.value = false
  }
}

function applyAdjust() {
  if (!tableId.value) {
    msg.value = 'テーブルを選んでください'
    return
  }
  const delta = Number(amount.value)
  run(
    () => adjustCoins({ tableId: tableId.value, delta, reason: reason.value }),
    `T${tableId.value} に ${delta >= 0 ? '+' : ''}${fmt(delta)} を反映しました`,
  )
}

function applyBonus() {
  const delta = Number(bonusAmount.value)
  run(async () => {
    await bulkBonus({ delta, reason: bonusReason.value })
    if (announcement.value) await setAnnouncement(announcement.value)
  }, `全テーブルに ${delta >= 0 ? '+' : ''}${fmt(delta)} を反映しました`)
}
</script>

<template>
  <div class="stack">
    <section class="card pad">
      <h3 class="h3">コインの補填（いつでも使えます）</h3>
      <div class="row row-wrap">
        <select v-model="tableId" style="min-width: 180px">
          <option value="">テーブルを選択</option>
          <option v-for="t in props.tables" :key="t.id" :value="t.id">
            T{{ t.id }} {{ t.name }}（{{ fmt(t.coins) }}）
          </option>
        </select>
        <div class="row">
          <button class="btn" @click="amount = Number(amount) - RULES.BET_STEP">−100</button>
          <input v-model="amount" type="number" :step="RULES.BET_STEP" style="width: 120px; text-align: right" />
          <button class="btn" @click="amount = Number(amount) + RULES.BET_STEP">＋100</button>
        </div>
        <input v-model="reason" placeholder="理由（任意）" style="flex: 1; min-width: 180px" />
        <button class="btn btn-primary" :disabled="busy" @click="applyAdjust">反映</button>
      </div>
    </section>

    <section class="card pad">
      <h3 class="h3">全テーブル一律ボーナス（第{{ RULES.BONUS_BEFORE_Q }}問前の演出用）</h3>
      <div class="row row-wrap">
        <input v-model="bonusAmount" type="number" :step="RULES.BET_STEP" style="width: 120px; text-align: right" />
        <input v-model="bonusReason" placeholder="理由" style="width: 180px" />
        <input v-model="announcement" placeholder="スクリーンに出す文言" style="flex: 1; min-width: 220px" />
        <button class="btn btn-primary" :disabled="busy" @click="applyBonus">全テーブルに反映</button>
      </div>
    </section>

    <section class="card pad">
      <h3 class="h3">スクリーンのお知らせ</h3>
      <div class="row row-wrap">
        <input v-model="announcement" placeholder="スクリーン上部に出す文言" style="flex: 1; min-width: 240px" />
        <button class="btn" :disabled="busy" @click="run(() => setAnnouncement(announcement), '表示しました')">
          表示
        </button>
        <button class="btn btn-ghost" :disabled="busy" @click="run(() => setAnnouncement(''), '消しました')">
          消す
        </button>
      </div>
    </section>

    <p v-if="msg" class="muted" style="margin: 0">{{ msg }}</p>
  </div>
</template>

<style scoped>
.pad {
  padding: 16px;
}
.h3 {
  margin: 0 0 12px;
  font-size: 1rem;
}
</style>
