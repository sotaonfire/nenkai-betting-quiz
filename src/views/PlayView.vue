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
// 所持コインが後から届いた・精算で変わったときに賭け金を整合させる。
// 0コインのテーブルが受付中に入室すると canBet は最初から false のまま変化しないので、
// immediate で初期値も揃える（揃えないと賭け金100のままで送信できない）
watch(
  canBet,
  (ok) => {
    if (!ok) bet.value = 0
    else if (bet.value < RULES.MIN_BET) bet.value = RULES.MIN_BET
  },
  { immediate: true },
)
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

// ---- Macau デザイン用ヘルパー ----
const SUITS = ['♠', '♥', '♦', '♣']
const SUIT_RED = [false, true, true, false]
const pad2 = (n) => String(n ?? 0).padStart(2, '0')
const topCoins = computed(() => Math.max(0, ...tables.value.map((t) => Number(t.coins ?? 0))))
const normBet = (v) =>
  Math.min(coins.value, Math.max(RULES.MIN_BET, Math.floor(v / RULES.BET_STEP) * RULES.BET_STEP))
function setBet(v) {
  if (submitted.value) return
  bet.value = normBet(v)
}
const quickBets = computed(() => [
  { label: String(RULES.MIN_BET), v: RULES.MIN_BET },
  { label: '半分', v: normBet(coins.value / 2) },
  { label: '3/4', v: normBet(coins.value * 0.75) },
  // validateBet は BET_STEP の倍数のみ許可するため、端数は切り捨てる
  { label: '全額', v: normBet(coins.value), all: true },
])
const standings = computed(() =>
  [...tables.value]
    .map((t) => ({ id: t.id, name: t.name ?? 'テーブル' + t.id, coins: Number(t.coins ?? 0), rank: t.finalRank ?? liveRanks.value[t.id] }))
    .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99)),
)
// 精算は settlement-core.js と同じく「正解で bet × (倍率 − 1) の増加」
const winGain = computed(() => bet.value * (multiplier.value - 1))
const resultHead = computed(() => {
  const r = myResult.value
  if (!r) return ''
  if (r.missing) return '未送信'
  return r.correct ? '正解！' : '不正解'
})
</script>

<template>
  <div class="macau" :class="{ 'modal-open': confirming }">
    <div class="wrap">
      <div v-if="booting" class="boot"><span class="dots"><i></i><i></i><i></i></span></div>

      <template v-else>
        <!-- 常時表示ヘッダ -->
        <header class="head">
          <div class="tbadge latin">{{ tableId }}</div>
          <div class="hmeta">
            <div class="kicker">CWD CASINO ・ {{ phaseLabel(phase) }}</div>
            <div class="tname">{{ myTable?.name ?? 'テーブル' + tableId }}</div>
          </div>
          <div class="spacer"></div>
          <div class="coinpill">
            <span class="coin-ico"></span>
            <span class="num">{{ tableLoaded ? fmt(coins) : '…' }}</span>
          </div>
        </header>
        <div v-if="game?.announcement" class="announce">{{ game.announcement }}</div>

        <!-- 開始前 -->
        <section v-if="phase === 'waiting'" class="panel">
          <div class="center-stack">
            <div class="kicker-lg latin">{{ currentQ === 1 ? 'WELCOME' : 'QUESTION ' + pad2(currentQ) }}</div>
            <div class="sub">{{ currentQ === 1 ? 'まもなくゲームが始まります' : '第' + currentQ + '問 準備中' }}</div>
            <div v-if="isFinalQuestion" class="final-badge">最終問題 ・ 配当{{ multiplier }}倍</div>
          </div>
          <div class="center-stack">
            <div class="kicker">COINS ・ 持ちコイン</div>
            <div class="bigcoins num">{{ tableLoaded ? fmt(coins) : '…' }}</div>
          </div>
          <div v-if="currentQ > 1 && myRank" class="stat2">
            <div class="stat">
              <div class="stat-l">現在の順位</div>
              <div class="stat-v num">{{ myRank }}<small> 位 / {{ RULES.TABLE_COUNT }}</small></div>
            </div>
            <div class="stat">
              <div class="stat-l">トップとの差</div>
              <div class="stat-v num">{{ myRank === 1 ? 'TOP' : '−' + fmt(topCoins - coins) }}</div>
            </div>
          </div>
          <div v-if="currentQ === 1" class="rules">
            <div class="kicker">HOUSE RULES</div>
            <div class="rl"><i class="rule-gem"></i><div>問題を見てから<b>回答と賭け金</b>をまとめて送信。100コイン単位・全額もOK</div></div>
            <div class="rl"><i class="rule-gem"></i><div>送信すると<b>賭け金だけ</b>がスクリーンに公開。送信後は変更できません</div></div>
            <div class="rl"><i class="rule-gem"></i><div>正解で賭け金ぶん<b class="green">プラス</b>、不正解で<b class="red">マイナス</b>。最終問題は配当{{ RULES.FINAL_MULTIPLIER }}倍</div></div>
          </div>
          <div class="grow"></div>
          <div class="foot">
            <div>スクリーンをご覧ください</div>
            <span class="dots"><i></i><i></i><i></i></span>
          </div>
        </section>

        <!-- 受付中 -->
        <section v-else-if="phase === 'answering'" class="panel bet-panel">
          <div class="qhead">
            <div class="qmeta">
              <div class="row" style="gap: 8px">
                <span class="kicker gold-k">QUESTION {{ pad2(currentQ) }} / {{ pad2(RULES.QUESTION_COUNT) }}</span>
                <span v-if="isFinalQuestion" class="mult-tag">FINAL ・ 配当{{ multiplier }}倍</span>
              </div>
              <p class="qtext display">{{ currentQuestion?.text ?? '（問題文の読み込み中）' }}</p>
            </div>
            <CountdownRing
              :started-at="game?.startedAt"
              :limit-sec="game?.timeLimitSec ?? RULES.DEFAULT_TIME_LIMIT_SEC"
              :size="64"
            />
          </div>

          <!-- 送信済み -->
          <template v-if="submitted">
            <div class="center-stack" style="margin-top: 18px">
              <div class="check">✓</div>
              <div class="kicker-lg latin">SUBMITTED</div>
              <div class="sub">送信完了 ・ 他のテーブルを待っています</div>
            </div>
            <div class="summary">
              <div class="srow">
                <span class="sl">回答</span>
                <span class="suit sm" :class="{ 'is-red': SUIT_RED[mySubmission.answerIndex] }">{{ SUITS[mySubmission.answerIndex] }}</span>
                <span class="sv">{{ CHOICE_LABELS[mySubmission.answerIndex] }}. {{ currentQuestion?.choices?.[mySubmission.answerIndex] }}</span>
              </div>
              <div class="srow">
                <span class="sl">賭け金</span>
                <span class="num sbet">{{ fmt(mySubmission.bet) }}</span>
                <span class="muted tiny">コイン</span>
              </div>
            </div>
            <div class="note">スクリーンには<b>賭け金だけ</b>が公開されています。<br />回答の中身は正解発表まで秘密です。</div>
          </template>

          <template v-else>
            <div class="choices">
              <button
                v-for="(c, i) in currentQuestion?.choices ?? []"
                :key="i"
                class="choice"
                :class="{ on: answerIndex === i }"
                @click="answerIndex = i"
              >
                <span class="suit" :class="{ 'is-red': SUIT_RED[i] }">{{ SUITS[i] }}</span>
                <span class="ctext"><b class="clabel latin">{{ CHOICE_LABELS[i] }}</b>{{ c }}</span>
                <span class="radio"><i></i></span>
              </button>
            </div>

            <div class="tray">
              <div class="tray-head">
                <span class="kicker">BET ・ 賭け金</span>
                <span class="muted tiny">手持ち {{ tableLoaded ? fmt(coins) : '…' }}</span>
              </div>
              <div v-if="!tableLoaded" class="muted center" style="padding: 14px">所持コインを読み込み中…</div>
              <div v-else-if="!canBet" class="zero-note">
                今回は賭けられません（正解で +{{ RULES.ZERO_COIN_REWARD }}）
              </div>
              <template v-else>
                <div class="stepper">
                  <button class="round" :disabled="bet <= RULES.MIN_BET" @click="stepBet(-RULES.BET_STEP)">−</button>
                  <div class="betval num">{{ fmt(bet) }}</div>
                  <button class="round" :disabled="bet >= coins" @click="stepBet(RULES.BET_STEP)">+</button>
                </div>
                <input
                  type="range"
                  class="slider"
                  :min="RULES.MIN_BET"
                  :max="coins"
                  :step="RULES.BET_STEP"
                  :value="bet"
                  @input="setBet(Number($event.target.value))"
                />
                <div class="quick">
                  <button
                    v-for="q in quickBets"
                    :key="q.label"
                    class="qbtn"
                    :class="{ on: bet === q.v, all: q.all }"
                    @click="setBet(q.v)"
                  >
                    {{ q.label }}
                  </button>
                </div>
                <div class="preview">
                  <div class="pv win">正解なら <b class="num">+{{ fmt(winGain) }}</b> → {{ fmt(coins + winGain) }}</div>
                  <div class="pv lose">不正解なら <b class="num">−{{ fmt(bet) }}</b> → {{ fmt(coins - bet) }}</div>
                </div>
              </template>
              <p v-if="error" class="err">{{ error }}</p>
              <button
                class="btn btn-primary btn-lg btn-block"
                :disabled="!canSubmit || busy"
                @click="confirming = true"
              >
                {{ busy ? '送信中…' : answerIndex === null ? '回答を選んでください' : '回答と賭け金を送信' }}
              </button>
            </div>
          </template>
        </section>

        <!-- 締切 -->
        <section v-else-if="phase === 'closed'" class="panel">
          <div class="center-stack" style="margin-top: 20px">
            <div class="nomore latin foil">NO MORE BETS</div>
            <div class="sub">ベット締切</div>
          </div>
          <div v-if="mySubmission" class="summary">
            <div class="srow">
              <span class="sl">回答</span>
              <span class="suit sm" :class="{ 'is-red': SUIT_RED[mySubmission.answerIndex] }">{{ SUITS[mySubmission.answerIndex] }}</span>
              <span class="sv">{{ CHOICE_LABELS[mySubmission.answerIndex] }}. {{ currentQuestion?.choices?.[mySubmission.answerIndex] }}</span>
            </div>
            <div class="srow">
              <span class="sl">賭け金</span>
              <span class="num sbet">{{ fmt(mySubmission.bet) }}</span>
              <span class="muted tiny">コイン</span>
            </div>
          </div>
          <div v-else class="zero-note">未送信のまま締め切られました</div>
          <div class="grow"></div>
          <div class="foot">
            <div>正解発表をお待ちください</div>
            <span class="dots"><i></i><i></i><i></i></span>
          </div>
        </section>

        <!-- 正解発表 -->
        <section v-else-if="phase === 'revealed'" class="panel">
          <div class="kicker center" style="margin-top: 20px">ANSWER ・ 正解は</div>
          <div v-if="correctIndex !== null" class="answer-card">
            <span class="suit lg" :class="{ 'is-red': SUIT_RED[correctIndex] }">{{ SUITS[correctIndex] }}</span>
            <div class="answer-t display">{{ CHOICE_LABELS[correctIndex] }}. {{ currentQuestion?.choices?.[correctIndex] }}</div>
          </div>
          <div v-if="mySubmission" class="center-stack">
            <div v-if="mySubmission.answerIndex === correctIndex" class="res-win display">正解！</div>
            <div v-else class="res-lose display">不正解</div>
          </div>
          <div class="grow"></div>
          <div class="foot"><div>コインを精算しています</div><span class="dots"><i></i><i></i><i></i></span></div>
        </section>

        <!-- 精算済み -->
        <section v-else-if="phase === 'settled' || phase === 'ranking'" class="panel">
          <template v-if="myResult">
            <div class="center-stack" style="margin-top: 16px">
              <div :class="myResult.correct ? 'res-win' : 'res-lose'" class="display">{{ resultHead }}</div>
            </div>
            <div v-if="correctIndex !== null" class="answer-card">
              <span class="suit" :class="{ 'is-red': SUIT_RED[correctIndex] }">{{ SUITS[correctIndex] }}</span>
              <div>
                <div class="kicker gold-k" style="font-size: 10px">ANSWER ・ 正解</div>
                <div class="answer-s">{{ currentQuestion?.choices?.[correctIndex] }}</div>
              </div>
            </div>
            <div class="center-stack delta-wrap">
              <div class="delta num" :class="myResult.delta > 0 ? 'green' : myResult.delta < 0 ? 'red' : 'muted'">
                {{ fmtDelta(myResult.delta) }}
              </div>
              <div class="muted tiny">
                賭け金 {{ fmt(myResult.bet) }}<template v-if="myResult.correct && isFinalQuestion"> ・ 配当{{ multiplier }}倍</template>
                <template v-if="myResult.missing">（未送信のため{{ fmt(myResult.bet) }}を賭けて不正解扱い）</template>
              </div>
            </div>
            <div class="stat2">
              <div class="stat">
                <div class="stat-l">持ちコイン</div>
                <div class="stat-v num"><small>{{ fmt(myResult.before ?? myResult.after - myResult.delta) }} →</small> <span class="gold">{{ fmt(myResult.after) }}</span></div>
              </div>
              <div class="stat">
                <div class="stat-l">順位</div>
                <div class="stat-v num">
                  <small v-if="myResult.prevRank">{{ myResult.prevRank }}位 →</small> {{ myResult.rank }}位
                  <small v-if="myResult.prevRank && myResult.prevRank > myResult.rank" class="green">▲{{ myResult.prevRank - myResult.rank }}</small>
                  <small v-else-if="myResult.prevRank && myResult.prevRank < myResult.rank" class="red">▼{{ myResult.rank - myResult.prevRank }}</small>
                </div>
              </div>
            </div>
            <div class="grow"></div>
            <div class="foot"><div>スクリーンで全テーブルの結果を発表中</div></div>
          </template>
          <template v-else>
            <div class="center-stack" style="margin-top: 40px">
              <div class="sub">精算中…</div>
              <span class="dots"><i></i><i></i><i></i></span>
            </div>
          </template>
        </section>

        <!-- 終了 -->
        <section v-else-if="phase === 'finished'" class="panel">
          <div class="center-stack" style="margin-top: 8px">
            <div class="kicker-lg latin">FINAL RESULT</div>
            <div class="final-rank"><span class="num">{{ myRank }}</span><b>位</b></div>
            <div class="sub">{{ myRank === 1 ? '優勝おめでとうございます！' : 'おつかれさまでした！' }}</div>
            <div class="muted tiny">正解数 {{ myTable?.correctCount ?? 0 }} / {{ RULES.QUESTION_COUNT }}</div>
          </div>
          <div class="standings">
            <div v-for="r in standings" :key="r.id" class="st-row" :class="{ me: r.id === tableId }">
              <span class="medal num" :class="'m' + r.rank">{{ r.rank }}</span>
              <span class="st-name">{{ r.name }}</span>
              <span class="num gold st-coins">{{ fmt(r.coins) }}</span>
            </div>
          </div>
        </section>
      </template>

      <ConfirmDialog
        :open="confirming"
        title="この内容で送信しますか？"
        message=""
        cancel-label="戻る"
        confirm-label="送信する"
        @confirm="doSubmit"
        @cancel="confirming = false"
      >
        <div class="summary" style="margin: 0">
          <div class="srow">
            <span class="sl">回答</span>
            <span class="suit sm" :class="{ 'is-red': SUIT_RED[answerIndex ?? 0] }">{{ SUITS[answerIndex ?? 0] }}</span>
            <span class="sv">{{ CHOICE_LABELS[answerIndex ?? 0] }}. {{ currentQuestion?.choices?.[answerIndex ?? 0] }}</span>
          </div>
          <div class="srow">
            <span class="sl">賭け金</span>
            <span class="num sbet">{{ fmt(bet) }}</span>
            <span class="muted tiny">コイン</span>
          </div>
        </div>
        <div class="warn">送信後は変更できません。テーブルで相談しましたか？</div>
      </ConfirmDialog>
    </div>
  </div>
</template>

<style scoped>
.wrap {
  max-width: 480px;
  min-height: 100vh;
  min-height: 100dvh;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
}
.boot {
  flex: 1;
  display: grid;
  place-items: center;
}
.tiny {
  font-size: 11px;
}
.grow {
  flex: 1;
}

/* ---- ヘッダ ---- */
.head {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: calc(10px + env(safe-area-inset-top)) 18px 12px;
  border-bottom: 1px solid rgba(242, 201, 106, 0.16);
  background: rgba(18, 4, 5, 0.82);
  backdrop-filter: blur(10px);
}
.tbadge {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  border: 1.5px solid var(--gold);
  display: grid;
  place-items: center;
  font-weight: 900;
  font-size: 19px;
  color: var(--gold-hi);
  background: rgba(0, 0, 0, 0.4);
}
.hmeta .kicker {
  font-size: 10px;
}
.tname {
  font-size: 15px;
  font-weight: 900;
}
.coinpill {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px 6px 7px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.45);
  border: 1px solid rgba(242, 201, 106, 0.45);
}
.coinpill .num {
  font-weight: 600;
  font-size: 19px;
  color: var(--gold-hi);
}
.announce {
  margin: 10px 16px 0;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(242, 201, 106, 0.14);
  border: 1px solid rgba(242, 201, 106, 0.5);
  color: var(--gold-hi);
  font-weight: 900;
  text-align: center;
}

/* ---- 各フェーズ共通 ---- */
.panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 24px 22px calc(28px + env(safe-area-inset-bottom));
}
.center-stack {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  text-align: center;
}
.kicker-lg {
  font-weight: 700;
  font-size: 14px;
  letter-spacing: 0.3em;
  color: var(--gold);
}
.gold-k {
  color: var(--gold);
}
.sub {
  font-size: 15px;
  font-weight: 700;
  color: rgba(239, 231, 214, 0.78);
}
.bigcoins {
  font-weight: 700;
  font-size: 76px;
  line-height: 1.1;
  color: var(--gold-hi);
  text-shadow: 0 2px 0 var(--gold-dim), 0 10px 30px rgba(242, 201, 106, 0.25);
}
.final-badge {
  margin-top: 6px;
  padding: 6px 16px;
  border-radius: 999px;
  background: var(--red-deep);
  border: 1px solid var(--gold);
  color: var(--gold-pale);
  font-weight: 900;
  letter-spacing: 0.08em;
}
.stat2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.stat {
  padding: 12px 14px;
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.4);
  border: 1px solid rgba(242, 201, 106, 0.25);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.stat-l {
  font-size: 11px;
  color: var(--muted);
}
.stat-v {
  font-weight: 600;
  font-size: 22px;
}
.stat-v small {
  font-size: 13px;
  font-weight: 400;
  color: var(--faint);
}
.stat-v small.green {
  color: var(--green);
}
.stat-v small.red {
  color: var(--red);
}
.rules {
  padding: 18px;
  border-radius: 14px;
  background: rgba(0, 0, 0, 0.4);
  border: 1px solid rgba(242, 201, 106, 0.3);
  display: grid;
  gap: 12px;
}
.rules .kicker {
  color: var(--gold);
}
.rl {
  display: flex;
  gap: 10px;
  font-size: 13px;
  line-height: 1.6;
}
.rl .rule-gem {
  width: 6px;
  height: 6px;
  margin-top: 7px;
}
.rl b {
  color: var(--gold-hi);
}
.rl b.green {
  color: var(--green);
}
.rl b.red {
  color: var(--red);
}
.foot {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  font-weight: 700;
  color: rgba(239, 231, 214, 0.75);
}

/* ---- 問題 ---- */
.bet-panel {
  /* 下端は、通信切断バナーが出ても送信ボタンまでスクロールできるだけの余白を取る */
  padding: 14px 0 calc(100px + env(safe-area-inset-bottom));
  gap: 0;
}
.qhead {
  display: flex;
  gap: 14px;
  align-items: flex-start;
  padding: 0 20px;
}
.qmeta {
  flex: 1;
  display: grid;
  gap: 8px;
}
.qtext {
  margin: 0;
  font-size: 19px;
  font-weight: 900;
  line-height: 1.5;
  text-wrap: pretty;
}
.choices {
  display: grid;
  gap: 8px;
  padding: 14px 16px 16px;
}
.choice {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 58px;
  padding: 8px 14px 8px 10px;
  border-radius: 12px;
  border: 1px solid rgba(242, 201, 106, 0.28);
  background: var(--lacquer);
  color: var(--fg);
  text-align: left;
  transition: box-shadow 0.15s, border-color 0.15s, background 0.15s;
}
.choice.on {
  border-color: var(--gold);
  background: linear-gradient(90deg, rgba(242, 201, 106, 0.22), rgba(242, 201, 106, 0.06));
  box-shadow: 0 0 0 1px var(--gold), 0 0 22px rgba(242, 201, 106, 0.25);
}
.ctext {
  flex: 1;
  font-size: 15px;
  font-weight: 700;
  line-height: 1.35;
}
.clabel {
  margin-right: 8px;
  color: var(--gold);
  font-weight: 700;
}
.radio {
  flex: none;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 1.5px solid rgba(239, 231, 214, 0.3);
  display: grid;
  place-items: center;
}
.radio i {
  width: 12px;
  height: 12px;
  border-radius: 50%;
}
.choice.on .radio {
  border-color: var(--gold);
}
.choice.on .radio i {
  background: var(--gold);
}

/* ---- 賭け金 ---- */
.tray {
  display: grid;
  gap: 11px;
  margin: 0 16px;
  padding: 16px;
  border-radius: 14px;
  background: rgba(0, 0, 0, 0.4);
  border: 1px solid rgba(242, 201, 106, 0.3);
}
.tray-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}
.stepper {
  display: flex;
  align-items: center;
  gap: 12px;
}
.round {
  flex: none;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  border: 1px solid rgba(242, 201, 106, 0.5);
  background: rgba(0, 0, 0, 0.4);
  color: var(--gold-hi);
  font-size: 24px;
  line-height: 1;
}
.round:disabled {
  opacity: 0.35;
}
.betval {
  flex: 1;
  text-align: center;
  font-weight: 700;
  font-size: 46px;
  line-height: 1;
  color: var(--gold-hi);
}
.slider {
  width: 100%;
  margin: 0;
}
.quick {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
}
.qbtn {
  height: 36px;
  border-radius: 8px;
  border: 1px solid rgba(242, 201, 106, 0.3);
  background: rgba(0, 0, 0, 0.35);
  color: var(--fg);
  font-size: 12px;
  font-weight: 700;
}
.qbtn.all {
  border-color: rgba(255, 90, 112, 0.45);
  color: var(--red-hi);
}
.qbtn.on {
  border-color: var(--gold);
  background: rgba(242, 201, 106, 0.2);
  color: var(--gold-hi);
}
.preview {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}
.pv {
  padding: 7px 10px;
  border-radius: 8px;
  font-size: 11px;
  color: rgba(239, 231, 214, 0.65);
}
.pv b {
  font-size: 15px;
  font-weight: 600;
}
.pv.win {
  background: rgba(95, 211, 154, 0.08);
  border: 1px solid rgba(95, 211, 154, 0.25);
}
.pv.win b {
  color: var(--green);
}
.pv.lose {
  background: rgba(255, 90, 112, 0.08);
  border: 1px solid rgba(255, 90, 112, 0.25);
}
.pv.lose b {
  color: var(--red);
}
.zero-note {
  padding: 14px;
  border-radius: 10px;
  background: rgba(255, 90, 112, 0.1);
  border: 1px solid rgba(255, 90, 112, 0.35);
  color: var(--red-hi);
  font-weight: 700;
  text-align: center;
  line-height: 1.6;
}
.err {
  margin: 0;
  color: var(--red-hi);
  text-align: center;
  font-size: 13px;
  font-weight: 700;
}

/* ---- 送信内容 ---- */
.check {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  border: 2px solid var(--gold);
  display: grid;
  place-items: center;
  font-size: 32px;
  color: var(--gold-hi);
  animation: macau-pop 0.35s ease-out;
}
.summary {
  margin: 20px 20px 0;
  border-radius: 14px;
  background: rgba(0, 0, 0, 0.45);
  border: 1px solid rgba(242, 201, 106, 0.3);
}
.panel .summary {
  margin: 0;
}
.srow {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
}
.srow + .srow {
  border-top: 1px solid rgba(242, 201, 106, 0.15);
}
.sl {
  width: 52px;
  font-size: 12px;
  color: var(--muted);
  flex: none;
}
.sv {
  font-size: 15px;
  font-weight: 700;
}
.sbet {
  font-weight: 600;
  font-size: 24px;
  color: var(--gold-hi);
}
.suit.sm {
  width: 30px;
  height: 30px;
  font-size: 16px;
}
.suit.lg {
  width: 52px;
  height: 52px;
  font-size: 28px;
}
.note {
  margin: 14px 20px 0;
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px dashed rgba(242, 201, 106, 0.3);
  font-size: 12px;
  line-height: 1.6;
  color: var(--muted);
  text-align: center;
}
.note b {
  color: var(--gold-hi);
}
.warn {
  margin-top: 12px;
  padding: 10px 14px;
  border-radius: 10px;
  background: rgba(255, 90, 112, 0.1);
  border: 1px solid rgba(255, 90, 112, 0.35);
  font-size: 13px;
  font-weight: 700;
  color: #ffb3bd;
  text-align: center;
}

/* ---- 結果 ---- */
.nomore {
  font-weight: 900;
  font-size: 34px;
  letter-spacing: 0.06em;
}
.answer-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px;
  border-radius: 14px;
  background: var(--lacquer);
  border: 1px solid var(--gold);
  box-shadow: 0 0 0 1px rgba(242, 201, 106, 0.3), 0 0 30px rgba(242, 201, 106, 0.2);
  animation: macau-rise 0.4s ease-out;
}
.answer-t {
  font-size: 20px;
  font-weight: 900;
  line-height: 1.4;
}
.answer-s {
  font-size: 17px;
  font-weight: 900;
}
.res-win {
  font-weight: 900;
  font-size: 60px;
  line-height: 1.15;
  background: linear-gradient(180deg, var(--gold-pale), var(--gold) 50%, var(--gold-lo));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  animation: macau-pop 0.45s ease-out;
}
.res-lose {
  font-weight: 900;
  font-size: 52px;
  line-height: 1.15;
  color: var(--faint);
  animation: macau-pop 0.45s ease-out;
}
.delta-wrap {
  animation: macau-rise 0.5s ease-out 0.15s both;
}
.delta {
  font-weight: 700;
  font-size: 66px;
  line-height: 1;
}

/* ---- 終了 ---- */
.final-rank {
  display: flex;
  align-items: baseline;
  gap: 4px;
  animation: macau-pop 0.5s ease-out;
}
.final-rank .num {
  font-weight: 700;
  font-size: 120px;
  line-height: 1;
  color: var(--gold-hi);
  text-shadow: 0 3px 0 var(--gold-dim), 0 12px 40px rgba(242, 201, 106, 0.3);
}
.final-rank b {
  font-size: 28px;
  color: var(--gold);
}
.standings {
  display: grid;
  gap: 5px;
}
.st-row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 44px;
  padding: 0 14px;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid transparent;
}
.st-row.me {
  background: rgba(242, 201, 106, 0.16);
  border-color: rgba(242, 201, 106, 0.55);
}
.st-row.me .st-name {
  color: var(--gold-hi);
}
.st-name {
  flex: 1;
  font-size: 14px;
  font-weight: 700;
}
.st-coins {
  font-weight: 600;
  font-size: 17px;
}
.medal {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-weight: 700;
  font-size: 13px;
  background: rgba(239, 231, 214, 0.14);
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
</style>
