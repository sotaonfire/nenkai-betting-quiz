<script setup>
import { computed, ref, watch } from 'vue'
import { setFinalRanks, finishGame } from '../lib/host.js'
import { computeRanks, fmt } from '../lib/util.js'

const props = defineProps({ tables: { type: Array, default: () => [] } })

const ranks = ref({})
const msg = ref('')
const busy = ref(false)

const autoRanks = computed(() =>
  computeRanks(props.tables.map((t) => ({ id: t.id, coins: Number(t.coins ?? 0) }))),
)

const tieGroups = computed(() => {
  const byCoins = {}
  props.tables.forEach((t) => {
    const c = Number(t.coins ?? 0)
    byCoins[c] = byCoins[c] || []
    byCoins[c].push(t)
  })
  return Object.entries(byCoins)
    .filter(([, g]) => g.length > 1)
    .map(([coins, g]) => ({ coins: Number(coins), tables: g }))
})

watch(
  () => props.tables,
  () => {
    if (Object.keys(ranks.value).length === 0) {
      ranks.value = { ...autoRanks.value }
    }
  },
  { immediate: true, deep: true },
)

const sorted = computed(() =>
  [...props.tables].sort((a, b) => (ranks.value[a.id] ?? 99) - (ranks.value[b.id] ?? 99)),
)

const duplicated = computed(() => {
  const used = Object.values(ranks.value)
  return used.length !== new Set(used).size
})

async function confirmRanks() {
  busy.value = true
  msg.value = ''
  try {
    await setFinalRanks(ranks.value)
    await finishGame()
    msg.value = '最終順位を確定しました'
  } catch (e) {
    msg.value = `エラー: ${e.message}`
  } finally {
    busy.value = false
  }
}

function resetToAuto() {
  ranks.value = { ...autoRanks.value }
}
</script>

<template>
  <section class="card pad">
    <h3 class="h3">最終順位の確定</h3>
    <p class="muted small" style="margin-top: 0">
      コイン数で自動計算した順位が入っています。同点はじゃんけんの結果に合わせて数字を書き換えてください。
    </p>

    <div v-if="tieGroups.length" class="tie">
      同点あり：
      <span v-for="g in tieGroups" :key="g.coins">
        {{ g.tables.map((t) => 'T' + t.id).join(' / ') }}（{{ fmt(g.coins) }}コイン）
      </span>
      → じゃんけんで決着
    </div>

    <table class="t">
      <thead>
        <tr>
          <th style="width: 90px">順位</th>
          <th>テーブル</th>
          <th class="num">コイン</th>
          <th class="num">正解数</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="t in sorted" :key="t.id">
          <td><input v-model.number="ranks[t.id]" type="number" min="1" style="width: 70px" /></td>
          <td>T{{ t.id }} {{ t.name }}</td>
          <td class="num tabular">{{ fmt(t.coins) }}</td>
          <td class="num tabular">{{ t.correctCount ?? 0 }}</td>
        </tr>
      </tbody>
    </table>

    <p v-if="duplicated" class="red small">同じ順位が重複しています</p>

    <div class="row" style="margin-top: 12px">
      <button class="btn btn-ghost" @click="resetToAuto">コイン順に戻す</button>
      <button class="btn btn-primary" :disabled="busy || duplicated" @click="confirmRanks">
        この順位で確定して終了
      </button>
      <span class="muted">{{ msg }}</span>
    </div>
  </section>
</template>

<style scoped>
.pad {
  padding: 16px;
}
.h3 {
  margin: 0 0 8px;
  font-size: 1rem;
}
.small {
  font-size: 0.85rem;
}
.t {
  width: 100%;
  border-collapse: collapse;
  margin-top: 10px;
}
.t th {
  text-align: left;
  color: var(--muted);
  font-size: 0.8rem;
  padding: 6px 8px;
  border-bottom: 1px solid var(--line);
}
.t td {
  padding: 8px;
  border-bottom: 1px solid var(--line);
}
.num {
  text-align: right;
}
.tie {
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(255, 204, 72, 0.12);
  border: 1px solid var(--gold-dim);
  color: var(--gold);
  font-weight: 700;
  margin-bottom: 10px;
}
</style>
