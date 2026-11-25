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
import { phaseLabel } from '../lib/phases.js'
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

// ---- Macau デザイン用ヘルパー ----
const SUITS = ['♠', '♥', '♦', '♣']
const SUIT_RED = [false, true, true, false]
const pad2 = (n) => String(n ?? 0).padStart(2, '0')
const maxCoins = computed(() => Math.max(1, ...rows.value.map((r) => r.coins)))
const barW = (c) => Math.max(3, (c / maxCoins.value) * 100) + '%'
const inQuestion = computed(() => ['answering', 'closed', 'revealed', 'settled'].includes(phase.value))
const showResults = computed(() => phase.value === 'revealed' || phase.value === 'settled')
const pillTone = computed(() =>
  phase.value === 'answering' ? 'tone-go' : phase.value === 'closed' ? 'tone-stop' : 'tone-gold',
)
const podium = computed(() => {
  const top = ranking.value.slice(0, 3)
  return [top[1], top[0], top[2]].filter(Boolean)
})
</script>

<template>
  <div class="screen macau">
    <div v-if="booting" class="boot"><span class="dots"><i></i><i></i><i></i></span></div>

    <template v-else>
      <div class="bulbs" aria-hidden="true"></div>
      <!-- ヘッダ -->
      <header class="shead">
        <div class="brand latin">CWD CASINO</div>
        <div class="event">2026 忘年会 BETTING QUIZ</div>
        <div class="spacer"></div>
        <div v-if="inQuestion" class="qno num">QUESTION {{ pad2(currentQ) }} / {{ pad2(RULES.QUESTION_COUNT) }}</div>
        <span v-if="inQuestion && isFinalQuestion" class="mult-tag big-tag">FINAL ・ 配当{{ multiplier }}倍</span>
        <div class="pill" :class="pillTone">{{ phaseLabel(phase) }}</div>
      </header>

      <div v-if="game?.announcement" class="announce">{{ game.announcement }}</div>

      <!-- ===== 待機中 ===== -->
      <main v-if="phase === 'waiting'" class="body">
        <template v-if="currentQ === 1">
          <div class="join">
            <div class="join-copy">
              <div class="logo latin foil">CWD</div>
              <div class="logo-sub latin">CASINO</div>
              <div class="rule" style="width: 22em"><span class="rule-gem"></span></div>
              <div class="join-lead display">各テーブル1台、スマホでアクセスして参加</div>
              <div class="join-url num">{{ joinUrl }}</div>
            </div>
            <div class="qr-frame">
              <QrCanvas :text="joinUrl" :size="300" />
            </div>
          </div>
          <div class="slots-head">
            <span class="kicker">TABLES JOINED</span>
            <span class="num gold slots-count">{{ joinedIds.length }} / {{ RULES.TABLE_COUNT }}</span>
          </div>
          <div class="slots">
            <div v-for="t in rows" :key="t.id" class="slot" :class="{ on: joinedIds.includes(t.id) }">
              <div class="slot-num latin">{{ t.id }}</div>
              <div class="slot-meta">
                <div class="slot-name">{{ t.name }}</div>
                <div class="slot-state">{{ joinedIds.includes(t.id) ? '入室済み' : '待機中' }}</div>
              </div>
            </div>
          </div>
        </template>
        <template v-else>
          <div class="next" :class="{ 'has-q': currentQuestion }">
            <template v-if="isFinalQuestion">
              <div class="kicker next-k">FINAL QUESTION</div>
              <div class="next-main display foil">最終問題 配当{{ RULES.FINAL_MULTIPLIER }}倍</div>
              <div class="next-note">ここで全額勝負も…？</div>
            </template>
            <template v-else>
              <div class="kicker next-k">NEXT</div>
              <div class="next-main latin foil">QUESTION {{ pad2(currentQ) }}</div>
              <div class="next-note">まもなく回答受付</div>
            </template>
            <span class="dots" style="margin-top: 0.6em"><i></i><i></i><i></i></span>
          </div>
          <!-- 受付前から問題と選択肢を見せる -->
          <div v-if="currentQuestion" class="next-q">
            <p class="qtext display">{{ currentQuestion.text }}</p>
            <div class="choices">
              <div v-for="(c, i) in currentQuestion.choices ?? []" :key="i" class="choice">
                <span class="suit" :class="{ 'is-red': SUIT_RED[i] }">{{ SUITS[i] }}</span>
                <span class="ctext"><b class="clabel latin">{{ CHOICE_LABELS[i] }}</b>{{ c }}</span>
              </div>
            </div>
          </div>
        </template>
      </main>

      <!-- ===== 出題 / 締切 / 正解発表 / 精算 ===== -->
      <main v-else-if="inQuestion" class="body qbody">
        <div class="qtop">
          <p class="qtext display">{{ currentQuestion?.text }}</p>
          <CountdownRing
            v-if="phase === 'answering'"
            :started-at="game?.startedAt"
            :limit-sec="game?.timeLimitSec ?? RULES.DEFAULT_TIME_LIMIT_SEC"
            :size="150"
          />
        </div>
        <div class="choices">
          <div
            v-for="(c, i) in currentQuestion?.choices ?? []"
            :key="i"
            class="choice"
            :class="{ correct: showResults && correctIndex === i, dim: showResults && correctIndex !== null && correctIndex !== i }"
          >
            <span class="suit" :class="{ 'is-red': SUIT_RED[i] }">{{ SUITS[i] }}</span>
            <span class="ctext"><b class="clabel latin">{{ CHOICE_LABELS[i] }}</b>{{ c }}</span>
            <span v-if="showResults && correctIndex === i" class="ok-tag">正解</span>
          </div>
        </div>

        <div class="tiles-head">
          <span class="kicker">{{ showResults ? 'RESULTS ・ 各テーブルの結果' : 'TABLE BETS ・ 公開された賭け金' }}</span>
          <span class="muted">送信 <b class="num gold sc">{{ submittedCount }}</b> / {{ RULES.TABLE_COUNT }}</span>
        </div>
        <div class="tiles">
          <div
            v-for="t in rows"
            :key="t.id"
            class="tile"
            :class="{
              done: t.bet !== null,
              win: t.result && t.result.delta > 0,
              lose: t.result && t.result.delta < 0,
            }"
          >
            <div class="tile-top">
              <span class="kicker tk">TABLE</span>
              <span class="tile-num latin">{{ t.id }}</span>
            </div>
            <div class="tile-name">{{ t.name }}</div>
            <div class="tile-body">
              <!-- 精算後: 回答と増減 -->
              <template v-if="t.result">
                <span v-if="t.result.answerIndex != null" class="tile-suit" :class="{ 'is-red': SUIT_RED[t.result.answerIndex] }">
                  {{ SUITS[t.result.answerIndex] }} {{ CHOICE_LABELS[t.result.answerIndex] }}
                </span>
                <span v-else class="muted tile-small">未送信</span>
                <span class="tile-delta num" :class="t.result.delta > 0 ? 'green' : t.result.delta < 0 ? 'red' : 'muted'">
                  {{ fmtDelta(t.result.delta) }}
                </span>
              </template>
              <!-- 受付中〜発表: 賭け金のみ -->
              <template v-else-if="t.bet !== null">
                <span class="kicker tk">BET</span>
                <span class="tile-bet num">{{ fmt(t.bet) }}</span>
                <span v-if="t.bet > 0 && t.bet === t.coins" class="mult-tag">ALL IN</span>
              </template>
              <template v-else-if="phase === 'answering'">
                <span class="dots dim-dots"><i></i><i></i><i></i></span>
                <span class="muted tile-small">相談中…</span>
              </template>
              <span v-else class="muted tile-small">未送信</span>
            </div>
            <div class="tile-coins num">{{ fmt(t.result ? t.result.after : t.coins) }} コイン</div>
          </div>
        </div>

        <div v-if="phase === 'closed'" class="nomore">
          <span class="nm-suit">♠ ♥</span>
          <span class="latin">NO MORE BETS</span>
          <span class="nm-suit">♦ ♣</span>
        </div>
      </main>

      <!-- ===== ランキング ===== -->
      <main v-else-if="phase === 'ranking'" class="body">
        <div class="st-head">
          <div class="h2 latin">STANDINGS</div>
          <div class="muted st-note">第{{ currentQ }}問 終了時点</div>
        </div>
        <div class="rank-list">
          <div v-for="(r, k) in ranking" :key="r.id" class="rank-row" :style="{ animationDelay: k * 60 + 'ms' }">
            <div class="rbar" :style="{ width: barW(r.coins) }"></div>
            <div class="medal num" :class="'m' + r.rank">{{ r.rank }}</div>
            <div class="rname">
              <div class="rn">{{ r.name }}</div>
              <div class="muted rc">正解 {{ r.correctCount }}問</div>
            </div>
            <div class="rmove num">
              <span v-if="move(r) > 0" class="green">▲{{ move(r) }}</span>
              <span v-else-if="move(r) < 0" class="red">▼{{ Math.abs(move(r)) }}</span>
              <span v-else class="muted">―</span>
            </div>
            <div class="rdelta num" :class="r.result ? (r.result.delta > 0 ? 'green' : r.result.delta < 0 ? 'red' : 'muted') : 'muted'">
              {{ r.result ? fmtDelta(r.result.delta) : '' }}
            </div>
            <div class="rcoins num">{{ fmt(r.coins) }}</div>
          </div>
        </div>
      </main>

      <!-- ===== 終了 ===== -->
      <main v-else-if="phase === 'finished'" class="body final">
        <div class="center">
          <div class="h2 latin foil" style="font-size: 2.6em">FINAL RESULT</div>
          <div class="muted final-sub">最終順位</div>
        </div>
        <div class="grow"></div>
        <div class="podium">
          <div v-for="r in podium" :key="r.id" class="pod" :class="'p' + r.rank">
            <div class="pname">{{ r.name }}</div>
            <div class="pcoins num">{{ fmt(r.coins) }}</div>
            <div class="pblock"><span class="latin">{{ r.rank }}</span></div>
          </div>
        </div>
        <div class="rest">
          <div v-for="r in ranking.slice(3)" :key="r.id" class="rest-item">
            <span class="muted num">{{ r.rank }}位</span>
            <b>{{ r.name }}</b>
            <span class="num gold">{{ fmt(r.coins) }}</span>
          </div>
        </div>
        <p v-if="tieGroups.length" class="center muted" style="margin: 0.4em 0 0">
          同点のテーブルがあります → じゃんけん決着
        </p>
      </main>
    </template>
  </div>
</template>

<style scoped>
/* 1920px幅で 1em ≒ 26px。プロジェクター解像度に合わせて全体が拡縮する */
.screen {
  position: relative;
  min-height: 100vh;
  font-size: clamp(14px, 1.36vw, 30px);
  display: flex;
  flex-direction: column;
  background: radial-gradient(ellipse at 50% 25%, var(--bg-hi), var(--bg-deep) 65%, #1a0406);
  overflow: hidden;
}
.boot {
  flex: 1;
  display: grid;
  place-items: center;
}
.bulbs {
  height: 0.32em;
  background: radial-gradient(circle, #ffe6a0 0 0.1em, transparent 0.15em) 0 0 / 0.85em 0.32em repeat-x;
  opacity: 0.8;
}
.grow {
  flex: 1;
}

/* ---- ヘッダ ---- */
.shead {
  display: flex;
  align-items: center;
  gap: 0.9em;
  height: 3.4em;
  padding: 0 1.8em;
  background: linear-gradient(180deg, rgba(8, 6, 10, 0.85), rgba(8, 6, 10, 0.5));
  border-bottom: 1px solid rgba(242, 201, 106, 0.45);
}
.brand {
  font-weight: 900;
  font-size: 1.35em;
  letter-spacing: 0.08em;
  color: var(--gold);
}
.event {
  font-size: 0.68em;
  font-weight: 700;
  letter-spacing: 0.2em;
  color: var(--muted);
}
.qno {
  font-size: 0.85em;
  font-weight: 500;
  letter-spacing: 0.25em;
  color: var(--gold);
}
.big-tag {
  font-size: 0.62em;
  padding: 0.3em 0.7em;
}
.pill {
  padding: 0.25em 0.75em;
  border-radius: 999px;
  font-size: 0.68em;
  font-weight: 700;
  border: 1px solid rgba(242, 201, 106, 0.45);
  background: rgba(242, 201, 106, 0.12);
  color: var(--gold-hi);
}
.pill.tone-go {
  border-color: rgba(95, 211, 154, 0.5);
  background: rgba(95, 211, 154, 0.15);
  color: var(--green);
}
.pill.tone-stop {
  border-color: rgba(255, 90, 112, 0.5);
  background: rgba(255, 90, 112, 0.15);
  color: var(--red-hi);
}
.announce {
  margin: 0.8em 1.8em 0;
  padding: 0.55em;
  border-radius: 0.5em;
  background: rgba(242, 201, 106, 0.16);
  border: 1px solid rgba(242, 201, 106, 0.55);
  color: var(--gold-hi);
  font-weight: 900;
  font-size: 1.3em;
  text-align: center;
}
.body {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.8em;
  padding: 1.2em 1.8em 1.4em;
  min-height: 0;
}
.kicker {
  font-size: 0.6em;
  letter-spacing: 0.35em;
  color: var(--muted);
}
.h2 {
  font-weight: 900;
  font-size: 1.5em;
  letter-spacing: 0.12em;
  color: var(--gold);
}
.h2.foil {
  color: transparent;
}

/* ---- 待機: 参加受付 ---- */
.join {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 2.4em;
  align-items: center;
  padding: 0 1.2em;
}
.join-copy {
  display: flex;
  flex-direction: column;
  gap: 0.5em;
}
.logo {
  font-weight: 900;
  font-size: 6.4em;
  line-height: 0.85;
  letter-spacing: 0.03em;
}
.logo-sub {
  font-weight: 700;
  font-size: 1.5em;
  letter-spacing: 0.6em;
  color: var(--gold);
}
.join-lead {
  font-size: 1.1em;
  font-weight: 900;
  letter-spacing: 0.1em;
}
.join-url {
  font-size: 1.2em;
  letter-spacing: 0.06em;
  color: var(--gold-hi);
}
.qr-frame {
  padding: 0.7em;
  border-radius: 0.8em;
  background: #f4efe4;
  box-shadow: 0 0 0 0.2em var(--gold), 0 0 0 0.35em #3a2a0c, 0 1.2em 2.5em rgba(0, 0, 0, 0.6);
  line-height: 0;
}
.qr-frame :deep(canvas) {
  width: 11em !important;
  height: 11em !important;
  padding: 0 !important;
  border-radius: 0.3em;
}
.slots-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}
.slots-count {
  font-weight: 600;
  font-size: 1em;
}
.slots {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 0.5em;
}
.slot {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5em;
  min-height: 3.2em;
  padding: 0.4em;
  border-radius: 0.6em;
  border: 1px solid rgba(239, 231, 214, 0.12);
  background: rgba(0, 0, 0, 0.3);
  color: var(--faint);
  transition: all 0.4s;
}
.slot.on {
  border-color: var(--gold);
  background: linear-gradient(180deg, rgba(242, 201, 106, 0.22), rgba(0, 0, 0, 0.4));
  color: var(--gold-hi);
}
.slot-num {
  font-weight: 900;
  font-size: 1.4em;
}
.slot-name {
  font-size: 0.5em;
  font-weight: 700;
}
.slot-state {
  font-size: 0.55em;
  font-weight: 700;
}

/* ---- 待機: 次の問題 ---- */
.next {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.4em;
  text-align: center;
}
.next-k {
  font-size: 0.8em;
  color: var(--gold);
}
.next-main {
  font-weight: 900;
  font-size: 4em;
  line-height: 1.15;
  /* foil は背景を文字で切り抜くので、Q の尾が欠けないよう下に余白を足す */
  padding-bottom: 0.12em;
}
.next.has-q {
  flex: none;
  gap: 0.2em;
  padding-top: 0.6em;
}
.next.has-q .next-main {
  font-size: 3em;
}
.next-q {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 1.2em;
}
.next-q .qtext {
  flex: none;
  text-align: center;
}
.next-note {
  font-size: 1.1em;
  font-weight: 700;
  color: rgba(239, 231, 214, 0.75);
}

/* ---- 出題 ---- */
.qtop {
  display: flex;
  align-items: center;
  gap: 1em;
  min-height: 3.4em;
}
.qtext {
  flex: 1;
  margin: 0;
  font-size: 1.5em;
  font-weight: 900;
  line-height: 1.4;
  text-wrap: pretty;
}
.choices {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5em;
}
.choice {
  display: flex;
  align-items: center;
  gap: 0.7em;
  min-height: 2.9em;
  padding: 0.3em 0.8em 0.3em 0.5em;
  border-radius: 0.6em;
  background: var(--lacquer);
  border: 1px solid rgba(242, 201, 106, 0.3);
  transition: opacity 0.5s, box-shadow 0.5s;
}
.choice .suit {
  font-size: 0.85em;
}
.choice.correct {
  border-color: var(--gold-hi);
  box-shadow: 0 0 0 2px var(--gold), 0 0 1.4em rgba(242, 201, 106, 0.5);
}
.choice.dim {
  opacity: 0.3;
}
.ctext {
  flex: 1;
  min-width: 0;
  font-size: 1.05em;
  font-weight: 700;
  line-height: 1.35;
  overflow-wrap: anywhere;
}
.clabel {
  margin-right: 0.5em;
  color: var(--gold);
}
.ok-tag {
  padding: 0.2em 0.5em;
  border-radius: 0.3em;
  background: var(--gold-plate);
  color: var(--gold-ink);
  font-weight: 900;
  font-size: 0.65em;
  letter-spacing: 0.1em;
  animation: macau-pop 0.4s ease-out;
}
.tiles-head {
  margin-top: auto;
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: 0.85em;
}
.tiles-head .kicker {
  font-size: 0.7em;
}
.sc {
  font-size: 1.3em;
  font-weight: 600;
}
.tiles {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 0.5em;
}
.tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.15em;
  min-height: 7.4em;
  padding: 0.55em 0.35em;
  border-radius: 0.7em;
  border: 1px solid rgba(239, 231, 214, 0.12);
  background: rgba(0, 0, 0, 0.3);
  transition: border-color 0.3s, background 0.3s;
}
.tile.done {
  border-color: rgba(242, 201, 106, 0.6);
  background: linear-gradient(180deg, rgba(242, 201, 106, 0.12), rgba(0, 0, 0, 0.4));
}
.tile.win {
  border-color: var(--gold);
  background: linear-gradient(180deg, rgba(242, 201, 106, 0.25), rgba(0, 0, 0, 0.4));
}
.tile.lose {
  border-color: rgba(239, 231, 214, 0.12);
  background: rgba(0, 0, 0, 0.55);
}
.tile-top {
  display: flex;
  align-items: baseline;
  gap: 0.3em;
}
.tk {
  font-size: 0.42em;
  letter-spacing: 0.25em;
}
.tile-num {
  font-weight: 900;
  font-size: 1.15em;
  color: var(--gold);
}
.tile-name {
  font-size: 0.5em;
  color: var(--muted);
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tile-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.2em;
  animation: macau-pop 0.35s ease-out;
}
.tile-bet {
  font-weight: 700;
  font-size: 1.45em;
  line-height: 1;
  color: var(--gold-hi);
}
.tile-suit {
  font-family: serif;
  font-size: 0.9em;
}
.tile-suit.is-red {
  color: var(--red);
}
.tile-delta {
  font-weight: 700;
  font-size: 1.25em;
  line-height: 1;
}
.tile-small {
  font-size: 0.58em;
  font-weight: 700;
}
.tile-coins {
  font-size: 0.55em;
  color: var(--muted);
}
.tile .mult-tag {
  font-size: 0.42em;
}
.dim-dots i {
  width: 0.3em;
  height: 0.3em;
  background: rgba(239, 231, 214, 0.5);
}
.nomore {
  position: absolute;
  left: -1em;
  right: -1em;
  top: 7.2em;
  height: 4em;
  transform: rotate(-3deg);
  background: linear-gradient(180deg, #a3142e, #6d0a1d);
  border-top: 3px solid var(--gold);
  border-bottom: 3px solid var(--gold);
  box-shadow: 0 1em 2em rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1.2em;
  font-weight: 900;
  font-size: 1em;
  animation: macau-pop 0.4s ease-out;
}
.nomore .latin {
  font-size: 2.2em;
  letter-spacing: 0.12em;
  color: var(--gold-pale);
  text-shadow: 0 3px 0 rgba(0, 0, 0, 0.4);
}
.nm-suit {
  font-family: serif;
  font-size: 1.1em;
  color: var(--gold);
}

/* ---- ランキング ---- */
.st-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 0 1em;
}
.st-note {
  font-size: 0.6em;
  font-weight: 700;
}
.rank-list {
  display: grid;
  gap: 0.35em;
  padding: 0 1em;
}
.rank-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.8em;
  min-height: 2.5em;
  padding: 0 1em 0 0.5em;
  border-radius: 0.55em;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(242, 201, 106, 0.18);
  overflow: hidden;
  animation: macau-rise 0.4s ease-out both;
}
.rbar {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  background: linear-gradient(90deg, rgba(242, 201, 106, 0.04), rgba(242, 201, 106, 0.2));
  transition: width 0.8s ease-out;
}
.rank-row > *:not(.rbar) {
  position: relative;
}
.medal {
  width: 1.6em;
  height: 1.6em;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-weight: 700;
  font-size: 0.85em;
  background: rgba(239, 231, 214, 0.14);
  flex: none;
}
.medal.m1 {
  background: var(--gold);
  color: #1a1206;
}
.medal.m2 {
  background: #c9ced6;
  color: #1a1206;
}
.medal.m3 {
  background: #c88a4a;
  color: #1a1206;
}
.rname {
  flex: 1;
}
.rn {
  font-size: 1em;
  font-weight: 900;
}
.rc {
  font-size: 0.5em;
}
.rmove {
  width: 3em;
  text-align: center;
  font-size: 0.75em;
}
.rdelta {
  width: 5em;
  text-align: right;
  font-size: 0.8em;
}
.rcoins {
  width: 5.5em;
  text-align: right;
  font-weight: 600;
  font-size: 1.35em;
  color: var(--gold-hi);
}

/* ---- 表彰 ---- */
.final {
  padding-bottom: 0;
}
.final-sub {
  font-size: 0.7em;
  font-weight: 700;
  letter-spacing: 0.3em;
}
.podium {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 1em;
}
.pod {
  width: 11em;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.35em;
  animation: macau-rise 0.6s ease-out both;
}
.pname {
  font-size: 1.2em;
  font-weight: 900;
}
.pcoins {
  font-weight: 600;
  font-size: 1.3em;
  color: var(--gold-hi);
}
.pblock {
  width: 100%;
  border-radius: 0.55em 0.55em 0 0;
  display: flex;
  justify-content: center;
  padding-top: 0.5em;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.5);
}
.pblock .latin {
  font-weight: 900;
  font-size: 3.2em;
  line-height: 1;
  color: #1a1206;
}
.p1 .pblock {
  height: 10em;
  background: linear-gradient(180deg, var(--gold), rgba(8, 6, 10, 0.9) 95%);
}
.p2 .pblock {
  height: 7.8em;
  background: linear-gradient(180deg, #c9ced6, rgba(8, 6, 10, 0.9) 95%);
}
.p3 .pblock {
  height: 6em;
  background: linear-gradient(180deg, #c88a4a, rgba(8, 6, 10, 0.9) 95%);
}
.p1 {
  animation-delay: 0.3s;
}
.rest {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 0.5em;
  padding: 0.6em 0 0.8em;
  border-top: 1px solid rgba(242, 201, 106, 0.4);
}
.rest-item {
  display: flex;
  align-items: baseline;
  gap: 0.4em;
  padding: 0.3em 0.7em;
  border-radius: 0.4em;
  background: rgba(0, 0, 0, 0.35);
  font-size: 0.75em;
}
</style>
