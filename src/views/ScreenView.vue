<script setup>
import { computed, onMounted, ref } from 'vue'
import { ensureAnonymousUser } from '../firebase.js'
import {
  currentQ,
  currentQuestion,
  game,
  pendingTableIds,
  phase,
  publicBets,
  reveal,
  settlement,
  startBaseSubscriptions,
  submittedCount,
  tables,
  usePresence,
} from '../lib/store.js'
import { RULES, TABLE_IDS, multiplierFor } from '../config.js'
import { CHOICE_LABELS, computeRanks, fmt, fmtDelta, toMillis } from '../lib/util.js'
import CountdownRing from '../components/CountdownRing.vue'
import QrCanvas from '../components/QrCanvas.vue'

const booting = ref(true)
const presence = usePresence()
const joinUrl = ref('')

onMounted(async () => {
  await ensureAnonymousUser()
  startBaseSubscriptions()
  joinUrl.value = `${window.location.origin}/`
  booting.value = false
})

const multiplier = computed(() => multiplierFor(currentQ.value))
const isFinalQuestion = computed(() => currentQ.value === RULES.QUESTION_COUNT)
const correctIndex = computed(() => reveal.value?.correctIndex ?? null)
const results = computed(() => settlement.value?.results ?? null)

const joinedIds = computed(() =>
  TABLE_IDS.filter((id) => {
    const p = presence.value[id]
    if (!p) return false
    return Date.now() - toMillis(p.at) < 5 * 60 * 1000
  }),
)

const rows = computed(() =>
  tables.value.map((t) => ({
    id: t.id,
    name: t.name ?? `テーブル${t.id}`,
    coins: Number(t.coins ?? 0),
    correctCount: Number(t.correctCount ?? 0),
    finalRank: t.finalRank ?? null,
    bet: publicBets.value[t.id]?.bet ?? null,
    result: results.value?.[t.id] ?? null,
  })),
)

const liveRanks = computed(() => computeRanks(rows.value.map((r) => ({ id: r.id, coins: r.coins }))))

const ranking = computed(() => {
  const list = [...rows.value]
  if (phase.value === 'finished' && list.every((r) => r.finalRank)) {
    return list.sort((a, b) => a.finalRank - b.finalRank).map((r) => ({ ...r, rank: r.finalRank }))
  }
  return list
    .sort((a, b) => b.coins - a.coins)
    .map((r) => ({ ...r, rank: liveRanks.value[r.id] }))
})

function move(row) {
  const prev = row.result?.prevRank
  const now = row.result?.rank ?? liveRanks.value[row.id]
  if (!prev || !now) return 0
  return prev - now
}

const tieGroups = computed(() => {
  const byCoins = {}
  rows.value.forEach((r) => {
    byCoins[r.coins] = byCoins[r.coins] || []
    byCoins[r.coins].push(r)
  })
  return Object.values(byCoins).filter((g) => g.length > 1)
})
</script>

<template>
  <div class="screen">
    <div v-if="booting" class="muted center">読み込み中…</div>

    <template v-else>
      <!-- ヘッダ -->
      <header class="shead">
        <div class="brand display foil">CWD&nbsp;CASINO</div>
        <div class="suits" aria-hidden="true">♠ ♥ ♦ ♣</div>
        <div class="spacer"></div>
        <div v-if="phase !== 'finished'" class="qno display">
          第<span class="big foil">{{ currentQ }}</span>問 / {{ RULES.QUESTION_COUNT }}
          <span class="chip" :class="isFinalQuestion ? 'chip-gold' : ''">配当{{ multiplier }}倍</span>
        </div>
      </header>

      <div v-if="game?.announcement" class="announce">{{ game.announcement }}</div>

      <!-- ===== 待機中 ===== -->
      <main v-if="phase === 'waiting'" class="body">
        <template v-if="currentQ === 1">
          <div class="waiting">
            <div class="qr-area">
              <QrCanvas :text="joinUrl" :size="300" />
              <div class="muted" style="margin-top: 12px; font-size: 1.1rem">{{ joinUrl }}</div>
            </div>
            <div class="join-list">
              <h2 class="h2 display">入室状況 {{ joinedIds.length }} / {{ RULES.TABLE_COUNT }}</h2>
              <div class="jgrid">
                <div
                  v-for="t in rows"
                  :key="t.id"
                  class="jcell"
                  :class="{ joined: joinedIds.includes(t.id) }"
                >
                  <div class="jnum display">T{{ t.id }}</div>
                  <div class="jname">{{ t.name }}</div>
                  <div class="jstate">{{ joinedIds.includes(t.id) ? '入室済み' : '待機中' }}</div>
                </div>
              </div>
            </div>
          </div>
        </template>
        <template v-else>
          <div class="center stack-lg">
            <div v-if="isFinalQuestion" class="final-hero">
              <div class="final-sub display">FINAL QUESTION</div>
              <div class="final-main display foil">最終問題 配当3倍</div>
              <div class="final-note">ここで全額勝負も…？</div>
            </div>
            <div v-else class="next-hero">
              <div class="muted">次は</div>
              <div class="next-main display foil">第{{ currentQ }}問</div>
            </div>
          </div>
        </template>
      </main>

      <!-- ===== 受付中 / 締切 ===== -->
      <main v-else-if="phase === 'answering' || phase === 'closed'" class="body qbody">
        <section class="qpane felt">
          <p class="qtext display">{{ currentQuestion?.text }}</p>
          <div class="choices">
            <div v-for="(c, i) in currentQuestion?.choices ?? []" :key="i" class="choice">
              <span class="clabel display">{{ CHOICE_LABELS[i] }}</span>
              <span>{{ c }}</span>
            </div>
          </div>
        </section>

        <aside class="side">
          <div class="side-top">
            <CountdownRing
              v-if="phase === 'answering'"
              :started-at="game?.startedAt"
              :limit-sec="game?.timeLimitSec ?? RULES.DEFAULT_TIME_LIMIT_SEC"
              :size="150"
            />
            <div v-else class="closed-badge">締め切りました</div>
            <div class="count display">
              送信 <span class="foil big2">{{ submittedCount }}</span> / {{ RULES.TABLE_COUNT }}
            </div>
          </div>
          <div class="blist">
            <div v-for="t in rows" :key="t.id" class="brow" :class="{ done: t.bet !== null }">
              <div class="bname">
                <span class="tnum display">T{{ t.id }}</span>
                <span class="muted">{{ t.name }}</span>
              </div>
              <div v-if="t.bet !== null" class="bbet tabular">
                {{ fmt(t.bet) }}<span class="unit">コイン</span>
                <span class="bet-tag">BET!</span>
              </div>
              <div v-else class="thinking">考え中…</div>
            </div>
          </div>
        </aside>
      </main>

      <!-- ===== 正解発表 / 精算 ===== -->
      <main v-else-if="phase === 'revealed' || phase === 'settled'" class="body">
        <div class="reveal-head">
          <div class="muted">正解</div>
          <div class="reveal-answer display foil">
            {{ CHOICE_LABELS[correctIndex] }}. {{ currentQuestion?.choices?.[correctIndex] }}
          </div>
        </div>
        <table class="rtable">
          <thead>
            <tr>
              <th>テーブル</th>
              <th>回答</th>
              <th>判定</th>
              <th class="num">賭け金</th>
              <th class="num">増減</th>
              <th class="num">所持コイン</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="t in rows" :key="t.id">
              <td>
                <span class="tnum">T{{ t.id }}</span>
                <span class="muted">{{ t.name }}</span>
              </td>
              <td>
                <template v-if="t.result">
                  <span v-if="t.result.answerIndex !== null">
                    {{ CHOICE_LABELS[t.result.answerIndex] }}
                  </span>
                  <span v-else class="muted">未送信</span>
                </template>
                <span v-else class="muted">—</span>
              </td>
              <td>
                <template v-if="t.result">
                  <span v-if="t.result.correct" class="chip chip-green">正解</span>
                  <span v-else class="chip chip-red">不正解</span>
                </template>
                <span v-else class="muted">—</span>
              </td>
              <td class="num tabular">{{ t.result ? fmt(t.result.bet) : fmt(t.bet) }}</td>
              <td class="num tabular" :class="t.result ? (t.result.delta >= 0 ? 'green' : 'red') : ''">
                {{ t.result ? fmtDelta(t.result.delta) : '—' }}
              </td>
              <td class="num tabular gold strong">{{ fmt(t.result ? t.result.after : t.coins) }}</td>
            </tr>
          </tbody>
        </table>
      </main>

      <!-- ===== ランキング ===== -->
      <main v-else-if="phase === 'ranking'" class="body">
        <h2 class="h2 center display">RANKING</h2>
        <div class="rank-list">
          <div v-for="r in ranking" :key="r.id" class="rank-row" :class="'r' + r.rank">
            <div class="rnum display">{{ r.rank }}</div>
            <div class="rname">
              <div class="tnum display">T{{ r.id }} {{ r.name }}</div>
              <div class="muted small">正解 {{ r.correctCount }}問</div>
            </div>
            <div class="rmove">
              <span v-if="move(r) > 0" class="green">▲{{ move(r) }}</span>
              <span v-else-if="move(r) < 0" class="red">▼{{ Math.abs(move(r)) }}</span>
              <span v-else class="muted">—</span>
            </div>
            <div class="rcoins tabular foil display">{{ fmt(r.coins) }}</div>
          </div>
        </div>
      </main>

      <!-- ===== 終了 ===== -->
      <main v-else-if="phase === 'finished'" class="body">
        <h2 class="h2 center display">FINAL RESULT</h2>
        <div class="podium">
          <div v-for="r in ranking.slice(0, 3)" :key="r.id" class="pod" :class="'p' + r.rank">
            <div class="pmedal">{{ ['🥇', '🥈', '🥉'][r.rank - 1] ?? '' }}</div>
            <div class="pname display">T{{ r.id }} {{ r.name }}</div>
            <div class="pcoins tabular foil display">{{ fmt(r.coins) }}</div>
          </div>
        </div>
        <div class="rank-list" style="margin-top: 20px">
          <div v-for="r in ranking.slice(3)" :key="r.id" class="rank-row">
            <div class="rnum display">{{ r.rank }}</div>
            <div class="rname">
              <div class="tnum">T{{ r.id }} {{ r.name }}</div>
            </div>
            <div class="rcoins tabular foil display">{{ fmt(r.coins) }}</div>
          </div>
        </div>
        <p v-if="tieGroups.length" class="center muted" style="margin-top: 16px">
          同点のテーブルがあります → じゃんけん決着
        </p>
      </main>
    </template>
  </div>
</template>

<style scoped>
.screen {
  min-height: 100vh;
  padding: 22px 34px 30px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* ---- ヘッダ ---- */
.shead {
  display: flex;
  align-items: center;
  gap: 18px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--gold-line);
}
.brand {
  font-size: 1.7rem;
  font-weight: 900;
  letter-spacing: 0.18em;
}
.suits {
  letter-spacing: 0.4em;
  color: var(--gold);
  opacity: 0.35;
  font-size: 0.9rem;
}
.qno {
  font-size: 1.5rem;
  font-weight: 800;
  display: flex;
  align-items: center;
  gap: 14px;
}
.big {
  font-size: 2.4rem;
  font-weight: 900;
}
.big2 {
  font-size: 2.6rem;
  font-weight: 900;
}
.announce {
  padding: 14px;
  border-radius: 12px;
  background: linear-gradient(180deg, rgba(240, 192, 74, 0.26), rgba(240, 192, 74, 0.08));
  border: 1px solid var(--gold-lo);
  color: var(--gold-hi);
  font-weight: 900;
  font-size: 1.7rem;
  text-align: center;
  letter-spacing: 0.04em;
  text-shadow: 0 0 24px rgba(240, 192, 74, 0.5);
}
.body {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 18px;
}
.h2 {
  font-size: 2rem;
  margin: 0;
  letter-spacing: 0.14em;
  color: var(--gold-hi);
}
.stack-lg {
  display: grid;
  gap: 18px;
}

/* ---- 待機中 ---- */
.waiting {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 44px;
  align-items: center;
}
.qr-area {
  text-align: center;
  padding: 22px;
  border-radius: 16px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.05), transparent);
  border: 1px solid var(--gold-line);
}
.jgrid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-top: 16px;
}
.jcell {
  padding: 14px;
  border-radius: 12px;
  background: linear-gradient(180deg, var(--panel-2), var(--panel));
  border: 1px solid #45202e;
}
.jcell.joined {
  border-color: var(--gold-lo);
  background: linear-gradient(180deg, rgba(240, 192, 74, 0.18), rgba(240, 192, 74, 0.04));
  box-shadow: 0 0 22px rgba(240, 192, 74, 0.2);
}
.jnum {
  font-size: 1.5rem;
  font-weight: 900;
  color: var(--gold-hi);
}
.jname {
  font-size: 0.9rem;
  color: var(--muted);
}
.jstate {
  margin-top: 6px;
  font-weight: 800;
  font-size: 0.85rem;
}
.jcell.joined .jstate {
  color: var(--gold);
}

/* ---- 次の問題 ---- */
.final-hero {
  display: grid;
  gap: 12px;
}
.final-sub {
  letter-spacing: 0.42em;
  color: var(--red-hi);
  font-weight: 700;
}
.final-main {
  font-size: 5rem;
  font-weight: 900;
  line-height: 1.15;
}
.final-note {
  color: var(--muted);
  font-size: 1.35rem;
}
.next-main {
  font-size: 4.4rem;
  font-weight: 900;
}

/* ---- 受付中 ---- */
.qbody {
  flex-direction: row;
  align-items: stretch;
  gap: 28px;
}
.qpane {
  flex: 1.3;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 30px 32px;
}
.qtext {
  font-size: 2.4rem;
  font-weight: 800;
  line-height: 1.55;
  margin: 0 0 26px;
}
.choices {
  display: grid;
  gap: 12px;
}
.choice {
  display: flex;
  gap: 18px;
  align-items: center;
  padding: 14px 20px;
  border-radius: 12px;
  background: linear-gradient(180deg, #fbf3e4, #e9dcc4);
  border: 1px solid #b9a177;
  color: #231a10;
  font-size: 1.55rem;
  font-weight: 700;
  box-shadow: 0 4px 0 rgba(0, 0, 0, 0.35);
}
.clabel {
  display: grid;
  place-items: center;
  width: 2em;
  height: 2em;
  border-radius: 8px;
  background: linear-gradient(180deg, #2b141e, #170a10);
  color: var(--gold-hi);
  font-weight: 900;
  flex: none;
}
.side {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.side-top {
  display: flex;
  align-items: center;
  gap: 20px;
  justify-content: center;
}
.count {
  font-size: 1.3rem;
  font-weight: 800;
}
.closed-badge {
  padding: 18px 22px;
  border-radius: 14px;
  background: linear-gradient(180deg, #8d1527, var(--red-deep));
  border: 1px solid #a8263a;
  color: #ffdfe4;
  font-weight: 900;
  font-size: 1.5rem;
  box-shadow: 0 0 30px rgba(224, 48, 73, 0.35);
}
.blist {
  display: grid;
  gap: 9px;
}
.brow {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 13px 18px;
  border-radius: 12px;
  background: linear-gradient(180deg, var(--panel-2), var(--panel));
  border: 1px solid #45202e;
  font-size: 1.25rem;
  transition: all 0.25s ease;
}
.brow.done {
  border-color: var(--gold-lo);
  background: linear-gradient(180deg, rgba(240, 192, 74, 0.16), rgba(240, 192, 74, 0.04));
  box-shadow: 0 0 20px rgba(240, 192, 74, 0.18);
}
.bname {
  flex: 1;
  display: flex;
  gap: 12px;
  align-items: baseline;
}
.tnum {
  font-weight: 900;
  color: var(--gold-hi);
}
.bbet {
  font-weight: 900;
  color: var(--gold-hi);
  font-size: 1.6rem;
  font-family: var(--display);
}
.unit {
  font-size: 0.78rem;
  margin-left: 3px;
  opacity: 0.8;
}
.bet-tag {
  margin-left: 12px;
  font-size: 0.82rem;
  padding: 3px 10px;
  border-radius: 999px;
  background: linear-gradient(180deg, #e8445b, var(--red));
  color: #fff;
  font-weight: 900;
  letter-spacing: 0.08em;
  vertical-align: middle;
  box-shadow: 0 0 16px rgba(224, 48, 73, 0.6);
}
.thinking {
  color: var(--muted);
  font-weight: 700;
  letter-spacing: 0.08em;
}

/* ---- 正解発表 ---- */
.reveal-head {
  text-align: center;
}
.reveal-answer {
  font-size: 3.2rem;
  font-weight: 900;
  line-height: 1.35;
}
.rtable {
  width: 100%;
  border-collapse: collapse;
  font-size: 1.32rem;
}
.rtable th {
  text-align: left;
  color: var(--muted);
  font-size: 0.92rem;
  letter-spacing: 0.1em;
  padding: 9px 12px;
  border-bottom: 1px solid var(--gold-line);
}
.rtable td {
  padding: 13px 12px;
  border-bottom: 1px solid #3a1a26;
}
.rtable .num {
  text-align: right;
}
.strong {
  font-weight: 900;
}

/* ---- ランキング ---- */
.rank-list {
  display: grid;
  gap: 10px;
}
.rank-row {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 15px 22px;
  border-radius: 14px;
  background: linear-gradient(180deg, var(--panel-2), var(--panel));
  border: 1px solid #45202e;
  font-size: 1.35rem;
}
.rank-row.r1 {
  border-color: var(--gold);
  background:
    linear-gradient(180deg, rgba(240, 192, 74, 0.2), rgba(240, 192, 74, 0.05));
  box-shadow: 0 0 34px rgba(240, 192, 74, 0.3);
}
.rank-row.r2 {
  border-color: #8d94a6;
}
.rank-row.r3 {
  border-color: #a9743f;
}
.rnum {
  font-size: 2.2rem;
  font-weight: 900;
  min-width: 2.4em;
  text-align: center;
  color: var(--gold-hi);
}
.rname {
  flex: 1;
}
.small {
  font-size: 0.86rem;
}
.rmove {
  font-weight: 900;
  min-width: 4em;
  text-align: center;
}
.rcoins {
  font-size: 2rem;
  font-weight: 900;
  min-width: 7em;
  text-align: right;
}

/* ---- 表彰 ---- */
.podium {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
  align-items: end;
}
.pod {
  padding: 24px;
  border-radius: 16px;
  background: linear-gradient(180deg, var(--panel-2), var(--panel));
  border: 1px solid #45202e;
  text-align: center;
}
.pod.p1 {
  border-color: var(--gold);
  background: linear-gradient(180deg, rgba(240, 192, 74, 0.2), rgba(240, 192, 74, 0.04));
  transform: scale(1.07);
  box-shadow: 0 0 44px rgba(240, 192, 74, 0.32);
}
.pod.p2 {
  border-color: #8d94a6;
}
.pod.p3 {
  border-color: #a9743f;
}
.pmedal {
  font-size: 3.2rem;
}
.pname {
  font-size: 1.45rem;
  font-weight: 900;
  margin: 8px 0;
  color: var(--gold-hi);
}
.pcoins {
  font-size: 2.1rem;
  font-weight: 900;
}
</style>
