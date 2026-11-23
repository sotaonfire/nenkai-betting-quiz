<script setup>
import { fmtDelta, toMillis } from '../lib/util.js'

const props = defineProps({ logs: { type: Array, default: () => [] } })

const LABELS = {
  init: '初期セットアップ',
  adjust: 'コイン補填',
  bonus: '一律ボーナス',
  proxy: '代理入力',
  cancel: '送信の取り消し',
  resettle: '精算のやり直し',
  reopen: '受付再開',
  reset: 'ゲームの初期化',
  finalize: '最終順位の確定',
  release: '端末の紐付け解除',
  passphrase: '合言葉の変更',
}

function timeOf(log) {
  const ms = toMillis(log.at)
  if (!ms) return '—'
  return new Date(ms).toLocaleTimeString('ja-JP')
}
</script>

<template>
  <section class="card pad">
    <h3 class="h3">操作ログ（直近50件）</h3>
    <table class="t">
      <thead>
        <tr>
          <th style="width: 90px">時刻</th>
          <th style="width: 150px">種別</th>
          <th style="width: 70px">対象</th>
          <th style="width: 100px">増減</th>
          <th>内容</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="log in props.logs" :key="log.id">
          <td class="muted tabular">{{ timeOf(log) }}</td>
          <td>{{ LABELS[log.type] ?? log.type }}</td>
          <td>{{ log.tableId ? 'T' + log.tableId : '—' }}</td>
          <td class="tabular">{{ log.delta !== undefined ? fmtDelta(log.delta) : '—' }}</td>
          <td class="muted">
            {{ log.reason || '' }}
            <template v-if="log.before !== undefined"> （{{ log.before }} → {{ log.after }}）</template>
            <template v-if="log.questionNo"> 第{{ log.questionNo }}問</template>
          </td>
        </tr>
        <tr v-if="!props.logs.length">
          <td colspan="5" class="muted">ログはまだありません</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style scoped>
.pad {
  padding: 16px;
}
.h3 {
  margin: 0 0 10px;
  font-size: 1rem;
}
.t {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}
.t th {
  text-align: left;
  color: var(--muted);
  font-size: 0.78rem;
  padding: 6px 8px;
  border-bottom: 1px solid var(--line);
}
.t td {
  padding: 7px 8px;
  border-bottom: 1px solid var(--line);
}
</style>
