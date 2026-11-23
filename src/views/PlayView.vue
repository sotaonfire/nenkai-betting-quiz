<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ensureAnonymousUser } from '../firebase.js'
import {
  currentQ,
  currentQuestion,
  game,
  phase,
  reveal,
  settlement,
  startBaseSubscriptions,
  tableMap,
  tables,
  useMySubmission,
} from '../lib/store.js'
import {
  currentClaim,
  rememberedTableId,
  startPresenceHeartbeat,
  submitAnswer,
  validateBet,
} from '../lib/player.js'
import { RULES, multiplierFor } from '../config.js'
import { CHOICE_LABELS, computeRanks, fmt, fmtDelta } from '../lib/util.js'
import { phaseLabel } from '../lib/phases.js'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import CountdownRing from '../components/CountdownRing.vue'

const router = useRouter()
const booting = ref(true)
const tableId = ref('')
const bet = ref(RULES.MIN_BET)
const answerIndex = ref(null)
const confirming = ref(false)
const busy = ref(false)
const error = ref('')

const mySubmission = useMySubmission(tableId)
let stopHeartbeat = null

onMounted(async () => {
  try {
    await ensureAnonymousUser()
    startBaseSubscriptions()
    const claimed = await currentClaim()
    if (!claimed) {
      router.replace('/')
      return
    }
    tableId.value = claimed
    stopHeartbeat = startPresenceHeartbeat(() => tableId.value)
  } catch (e) {
    // 初期化に失敗しても画面は開く。購読が復帰すれば自動で表示される
    const remembered = rememberedTableId()
    if (!remembered) {
      router.replace('/')
      return
    }
    tableId.value = remembered
    stopHeartbeat = startPresenceHeartbeat(() => tableId.value)
  } finally {
    booting.value = false
  }
})

onUnmounted(() => stopHeartbeat?.())

const myTable = computed(() => tableMap.value[tableId.value] ?? null)
// テーブルの購読が届く前は「所持0」と区別する。
// 区別しないと、読み込み中に「今回は賭けられません」と誤表示してしまう
const tableLoaded = computed(() => myTable.value !== null)
const coins = computed(() => Number(myTable.value?.coins ?? 0))
const canBet = computed(() => tableLoaded.value && coins.value >= RULES.MIN_BET)
const multiplier = computed(() => multiplierFor(currentQ.value))
const isFinalQuestion = computed(() => currentQ.value === RULES.QUESTION_COUNT)
const submitted = computed(() => !!mySubmission.value)

const myResult = computed(() => settlement.value?.results?.[tableId.value] ?? null)
const correctIndex = computed(() => reveal.value?.correctIndex ?? null)

const liveRanks = computed(() => computeRanks(tables.value.map((t) => ({ id: t.id, coins: Number(t.coins ?? 0) }))))
const myRank = computed(() => myTable.value?.finalRank ?? liveRanks.value[tableId.value] ?? null)

// 問題が変わったら入力をリセットする
watch([currentQ, phase], () => {
  if (phase.value === 'answering' && !submitted.value) {
    bet.value = canBet.value ? RULES.MIN_BET : 0
    answerIndex.value = null
    error.value = ''
  }
})
// 所持コインが後から届いた・精算で変わったときに賭け金を整合させる
watch(canBet, (ok) => {
  if (!ok) bet.value = 0
  else if (bet.value < RULES.MIN_BET) bet.value = RULES.MIN_BET
})
watch(coins, (c) => {
  if (canBet.value && bet.value > c) bet.value = c
})

function stepBet(d) {
  const next = bet.value + d
  bet.value = Math.min(coins.value, Math.max(RULES.MIN_BET, next))
}
function allIn() {
  bet.value = coins.value
}

const canSubmit = computed(
  () =>
    phase.value === 'answering' &&
    !submitted.value &&
    tableLoaded.value &&
    answerIndex.value !== null &&
    validateBet(bet.value, coins.value),
)

async function doSubmit() {
  confirming.value = false
  if (!canSubmit.value || busy.value) return
  busy.value = true
  error.value = ''
  try {
    await submitAnswer({
      questionNo: currentQ.value,
      tableId: tableId.value,
      bet: bet.value,
      answerIndex: answerIndex.value,
    })
  } catch (e) {
    error.value = e.message || '送信に失敗しました'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="wrap">
    <div v-if="booting" class="muted center">読み込み中…</div>

    <template v-else>
      <!-- 常時表示ヘッダ -->
      <header class="card head">
        <div class="suits" aria-hidden="true">♠ ♥ ♦ ♣</div>
        <div class="row">
          <div>
            <div class="tname display">T{{ tableId }} {{ myTable?.name }}</div>
            <div class="muted tiny">第{{ currentQ }}問 / {{ RULES.QUESTION_COUNT }}問 ・ {{ phaseLabel(phase) }}</div>
          </div>
          <div class="spacer"></div>
          <div class="coinbox">
            <div class="muted tiny">所持コイン</div>
            <div class="coins tabular foil display">{{ tableLoaded ? fmt(coins) : '…' }}</div>
          </div>
        </div>
        <div v-if="game?.announcement" class="announce">{{ game.announcement }}</div>
      </header>

      <!-- 開始前 -->
      <section v-if="phase === 'waiting'" class="card pad center stack">
        <div v-if="isFinalQuestion" class="final-badge display">最終問題 ・ 配当3倍</div>
        <div class="rule rule-mark"></div>
        <h2 class="display" style="margin: 0">第{{ currentQ }}問 準備中</h2>
        <p class="muted" style="margin: 0">スクリーンをご覧ください</p>
      </section>

      <!-- 受付中 -->
      <section v-else-if="phase === 'answering'" class="stack">
        <div class="card pad">
          <div class="row" style="justify-content: space-between; align-items: flex-start">
            <div class="chip" :class="isFinalQuestion ? 'chip-gold' : ''">
              第{{ currentQ }}問 ・ 配当{{ multiplier }}倍
            </div>
            <CountdownRing
              :started-at="game?.startedAt"
              :limit-sec="game?.timeLimitSec ?? RULES.DEFAULT_TIME_LIMIT_SEC"
              :size="72"
            />
          </div>
          <p class="qtext display">{{ currentQuestion?.text ?? '（問題文の読み込み中）' }}</p>
        </div>

        <div class="felt pad stack">
          <div class="label">回答</div>
          <button
            v-for="(c, i) in currentQuestion?.choices ?? []"
            :key="i"
            class="btn choice"
            :class="{ on: answerIndex === i }"
            :disabled="submitted"
            @click="answerIndex = i"
          >
            <span class="clabel">{{ CHOICE_LABELS[i] }}</span>
            <span class="ctext">{{ c }}</span>
          </button>
        </div>

        <div class="card pad stack">
          <div class="label">賭け金</div>
          <div v-if="!tableLoaded" class="muted center" style="padding: 18px">
            所持コインを読み込み中…
          </div>
          <div v-else-if="!canBet" class="zero-note">
            今回は賭けられません（正解で +{{ RULES.ZERO_COIN_REWARD }}）
          </div>
          <template v-else>
            <div class="bet-circle">
              <div class="bet-circle-inner">
                <div class="muted bet-cap">BET</div>
                <div class="betval tabular foil display">{{ fmt(bet) }}</div>
              </div>
            </div>
            <div class="row">
              <button class="btn" style="flex: 1" :disabled="submitted || bet <= RULES.MIN_BET" @click="stepBet(-RULES.BET_STEP)">
                −100
              </button>
              <button class="btn" style="flex: 1" :disabled="submitted || bet >= coins" @click="stepBet(RULES.BET_STEP)">
                ＋100
              </button>
              <button class="btn" style="flex: 1" :disabled="submitted || bet === coins" @click="allIn">
                全額
              </button>
            </div>
            <div class="muted tiny">最低100 / 上限 {{ fmt(coins) }}（所持コイン）</div>
          </template>
        </div>

        <div v-if="submitted" class="card pad center submitted">
          <div class="chip chip-green">送信済み</div>
          <div style="margin-top: 10px">
            賭け金 <strong class="tabular gold">{{ fmt(mySubmission.bet) }}</strong> ／ 回答
            <strong class="gold">{{ CHOICE_LABELS[mySubmission.answerIndex] }}</strong>
          </div>
          <div class="muted tiny" style="margin-top: 6px">送信後の変更はできません</div>
        </div>
        <template v-else>
          <p v-if="error" class="red center" style="margin: 0">{{ error }}</p>
          <button
            class="btn btn-primary btn-lg btn-block"
            :disabled="!canSubmit || busy"
            @click="confirming = true"
          >
            {{ busy ? '送信中…' : '送信' }}
          </button>
          <p class="muted tiny center" style="margin: 0">
            回答を選ぶと送信できます。送信後は変更できません。
          </p>
        </template>
      </section>

      <!-- 締切 -->
      <section v-else-if="phase === 'closed'" class="card pad center stack">
        <h2 style="margin: 0">締め切りました</h2>
        <div v-if="mySubmission" class="muted">
          賭け金 {{ fmt(mySubmission.bet) }} ／ 回答 {{ CHOICE_LABELS[mySubmission.answerIndex] }}
        </div>
        <div v-else class="red">未送信のまま締め切られました</div>
      </section>

      <!-- 正解発表 -->
      <section v-else-if="phase === 'revealed'" class="card pad center stack">
        <div class="muted">正解は</div>
        <div class="answer foil display">
          {{ CHOICE_LABELS[correctIndex] }}. {{ currentQuestion?.choices?.[correctIndex] }}
        </div>
        <div v-if="mySubmission">
          <span v-if="mySubmission.answerIndex === correctIndex" class="chip chip-green">正解！</span>
          <span v-else class="chip chip-red">不正解</span>
        </div>
      </section>

      <!-- 精算済み -->
      <section v-else-if="phase === 'settled' || phase === 'ranking'" class="card pad center stack">
        <template v-if="myResult">
          <span v-if="myResult.correct" class="chip chip-green">正解！</span>
          <span v-else class="chip chip-red">不正解</span>
          <div class="delta tabular" :class="myResult.delta >= 0 ? 'green' : 'red'">
            {{ fmtDelta(myResult.delta) }}
          </div>
          <div class="muted tiny">
            賭け金 {{ fmt(myResult.bet) }}
            <template v-if="myResult.missing">（未送信のため{{ fmt(myResult.bet) }}を賭けて不正解扱い）</template>
          </div>
          <div style="margin-top: 6px">
            所持コイン <strong class="tabular gold">{{ fmt(myResult.after) }}</strong>
          </div>
          <div class="muted tiny">現在 {{ myResult.rank }}位</div>
        </template>
        <template v-else>
          <h2 style="margin: 0">精算中…</h2>
          <p class="muted" style="margin: 0">スクリーンをご覧ください</p>
        </template>
      </section>

      <!-- 終了 -->
      <section v-else-if="phase === 'finished'" class="card pad center stack">
        <div class="muted">最終順位</div>
        <div class="rank foil display">{{ myRank }}位</div>
        <div>
          所持コイン <strong class="tabular gold">{{ fmt(coins) }}</strong>
        </div>
        <div class="muted tiny">正解数 {{ myTable?.correctCount ?? 0 }} / {{ RULES.QUESTION_COUNT }}</div>
        <p class="muted" style="margin: 0">おつかれさまでした！</p>
      </section>
    </template>

    <ConfirmDialog
      :open="confirming"
      title="送信の確認"
      :message="`賭け金 ${fmt(bet)} ／ 回答 ${CHOICE_LABELS[answerIndex ?? 0]} で送信します。\n送信後は変更できません。`"
      confirm-label="送信する"
      @confirm="doSubmit"
      @cancel="confirming = false"
    />
  </div>
</template>

<style scoped>
.wrap {
  max-width: 520px;
  margin: 0 auto;
  padding: 12px 12px 80px;
  display: grid;
  gap: 12px;
}

/* ---- ヘッダ ---- */
.head {
  padding: 14px 16px 12px;
  position: sticky;
  top: 0;
  z-index: 10;
  overflow: hidden;
  backdrop-filter: blur(8px);
}
.suits {
  position: absolute;
  top: 6px;
  right: 12px;
  font-size: 0.7rem;
  letter-spacing: 0.35em;
  color: var(--gold);
  opacity: 0.28;
}
.tname {
  font-weight: 900;
  font-size: 1.1rem;
  color: var(--gold-hi);
}
.tiny {
  font-size: 0.74rem;
  letter-spacing: 0.04em;
}
.coinbox {
  text-align: right;
}
.coins {
  font-size: 1.7rem;
  font-weight: 900;
  line-height: 1.05;
}
.announce {
  margin-top: 12px;
  padding: 9px 10px;
  border-radius: 10px;
  background: linear-gradient(180deg, rgba(240, 192, 74, 0.24), rgba(240, 192, 74, 0.07));
  border: 1px solid var(--gold-lo);
  color: var(--gold-hi);
  font-weight: 900;
  text-align: center;
}

.pad {
  padding: 16px;
}
.label {
  font-weight: 800;
  font-size: 0.78rem;
  color: var(--muted);
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

/* ---- 問題 ---- */
.qtext {
  margin: 14px 0 0;
  font-size: 1.2rem;
  font-weight: 700;
  line-height: 1.7;
  color: var(--fg);
}

/* ---- 選択肢（トランプ風） ---- */
.choice {
  position: relative;
  justify-content: flex-start;
  gap: 14px;
  text-align: left;
  padding: 14px 14px 14px 12px;
  line-height: 1.5;
  background: linear-gradient(180deg, #fbf3e4, #ece0c9);
  border: 1px solid #b9a177;
  color: #231a10;
  box-shadow: 0 4px 0 rgba(0, 0, 0, 0.35);
}
.choice .clabel {
  display: grid;
  place-items: center;
  width: 2em;
  height: 2em;
  border-radius: 7px;
  background: linear-gradient(180deg, #2b141e, #170a10);
  color: var(--gold-hi);
  font-family: var(--display);
  font-weight: 900;
  font-size: 1.05rem;
  flex: none;
}
.choice .ctext {
  flex: 1;
  font-weight: 700;
}
.choice.on {
  background: linear-gradient(180deg, var(--gold-hi), var(--gold) 55%, #cf9c2e);
  border-color: #6b4c12;
  color: #2a1b00;
  box-shadow: 0 4px 0 #6b4c12, 0 0 26px rgba(240, 192, 74, 0.45);
}
.choice.on .clabel {
  background: #2a1b00;
}
.choice:disabled {
  opacity: 0.55;
}

/* ---- 賭け金（ベッティングサークル） ---- */
.bet-circle {
  justify-self: center;
  width: 170px;
  height: 170px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  border: 2px dashed rgba(240, 192, 74, 0.5);
  background: radial-gradient(circle at 50% 35%, rgba(240, 192, 74, 0.14), transparent 70%);
}
.bet-circle-inner {
  text-align: center;
}
.bet-cap {
  font-size: 0.7rem;
  letter-spacing: 0.3em;
  font-weight: 800;
}
.betval {
  font-size: 2.3rem;
  font-weight: 900;
  line-height: 1.1;
}
.zero-note {
  padding: 15px;
  border-radius: 10px;
  background: linear-gradient(180deg, rgba(224, 48, 73, 0.2), rgba(224, 48, 73, 0.06));
  border: 1px solid #9b2134;
  color: #ffd2d8;
  font-weight: 800;
  text-align: center;
  line-height: 1.6;
}

/* ---- 送信済み ---- */
.submitted {
  border-color: var(--gold-lo);
  box-shadow: var(--shadow), inset 0 0 0 1px rgba(240, 192, 74, 0.3);
}

/* ---- 結果 ---- */
.answer {
  font-size: 1.7rem;
  font-weight: 900;
  line-height: 1.45;
}
.delta {
  font-size: 2.9rem;
  font-weight: 900;
  line-height: 1;
  font-family: var(--display);
  text-shadow: 0 0 24px currentColor;
}
.rank {
  font-size: 3.4rem;
  font-weight: 900;
  line-height: 1;
}
.final-badge {
  display: inline-block;
  padding: 7px 18px;
  border-radius: 999px;
  background: linear-gradient(180deg, var(--gold-hi), var(--gold) 55%, #c08f28);
  color: #2a1b00;
  font-weight: 900;
  letter-spacing: 0.08em;
  justify-self: center;
  box-shadow: 0 0 30px rgba(240, 192, 74, 0.45);
}
</style>
