<script setup>
import { computed, onMounted, ref } from 'vue'
import { signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { getDoc } from 'firebase/firestore'
import { auth, waitForAuth } from '../firebase.js'
import { configRef } from '../lib/paths.js'
import {
  currentQ,
  currentQuestion,
  game,
  isOpening,
  pendingTableIds,
  phase,
  publicBets,
  settlement,
  startBaseSubscriptions,
  submittedCount,
  tables,
  hostSubmissions,
  hostPresence,
  hostLogs,
  startHostSubscriptions,
} from '../lib/store.js'
import {
  cancelSubmission,
  closeAnswering,
  finishGame,
  goToNextQuestion,
  proxySubmit,
  releaseTable,
  reopenAnswering,
  resetGame,
  revealAnswer,
  runSettlement,
  setPhase,
  setPreviewQ1,
  showRanking,
  startQuestion,
  undoSettlement,
} from '../lib/host.js'
import { PHASE_ORDER, phaseLabel } from '../lib/phases.js'
import { useNow } from '../lib/now.js'
import { RULES, TABLE_IDS, multiplierFor } from '../config.js'
import { CHOICE_LABELS, fmt, fmtDelta, toMillis } from '../lib/util.js'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import AdminAdjust from '../components/AdminAdjust.vue'
import AdminSetup from '../components/AdminSetup.vue'
import AdminLogs from '../components/AdminLogs.vue'
import AdminFinalize from '../components/AdminFinalize.vue'

const booting = ref(true)
const isHost = ref(false)
const uid = ref('')
const email = ref('')
const password = ref('')
const loginError = ref('')
const tab = ref('flow')
const msg = ref('')
const busy = ref(false)

onMounted(async () => {
  const user = await waitForAuth()
  uid.value = user?.uid ?? ''
  if (user && !user.isAnonymous) await checkHost()
  booting.value = false
})

async function checkHost() {
  try {
    await getDoc(configRef('secret'))
    isHost.value = true
    startBaseSubscriptions()
    startHostSubscriptions()
  } catch (e) {
    isHost.value = false
    loginError.value =
      'このアカウントは司会として登録されていません。firestore.rules の hostUids に下のUIDを追記して、ルールを再デプロイしてください。'
  }
}

async function login() {
  loginError.value = ''
  busy.value = true
  try {
    const cred = await signInWithEmailAndPassword(auth, email.value.trim(), password.value)
    uid.value = cred.user.uid
    await checkHost()
  } catch (e) {
    loginError.value =
      e?.code === 'auth/invalid-credential'
        ? 'メールアドレスかパスワードが違います'
        : `ログインに失敗しました（${e?.code ?? e.message}）`
  } finally {
    busy.value = false
  }
}

function copyUid() {
  navigator.clipboard?.writeText(uid.value)
  msg.value = 'UIDをコピーしました'
}

async function logout() {
  await signOut(auth)
  location.reload()
}

// ---------------- 進行 ----------------
const now = useNow()
const subsMap = computed(() => hostSubmissions.value)
const presenceMap = computed(() => hostPresence.value)
const logList = computed(() => hostLogs.value)

const isLastQuestion = computed(() => currentQ.value >= RULES.QUESTION_COUNT)
const settled = computed(() => !!settlement.value)

const rows = computed(() =>
  tables.value.map((t) => {
    const sub = subsMap.value[t.id] ?? null
    const pub = publicBets.value[t.id] ?? null
    const seen = toMillis(presenceMap.value[t.id]?.at)
    return {
      ...t,
      coins: Number(t.coins ?? 0),
      sub,
      pub,
      online: seen > 0 && now.value - seen < RULES.PRESENCE_STALE_MS,
      everSeen: seen > 0,
      mismatch: !!sub && !!pub && sub.bet !== pub.bet,
      result: settlement.value?.results?.[t.id] ?? null,
    }
  }),
)

async function act(fn, okMsg) {
  if (busy.value) return
  busy.value = true
  msg.value = ''
  try {
    const r = await fn()
    msg.value = r?.skipped ? 'すでに精算済みのため何もしませんでした' : okMsg
  } catch (e) {
    msg.value = `エラー: ${e.message}`
  } finally {
    busy.value = false
  }
}

// 締切の確認ダイアログ
const closeConfirm = ref(false)
function tryClose() {
  if (pendingTableIds.value.length > 0) {
    closeConfirm.value = true
    return
  }
  act(closeAnswering, '締め切りました')
}

// リセット（2段階確認）
const resetStep = ref(0)

// 代理入力
const proxy = ref({ open: false, tableId: '', bet: RULES.MIN_BET, answerIndex: null })
function openProxy(row) {
  proxy.value = {
    open: true,
    tableId: row.id,
    bet: row.coins < RULES.MIN_BET ? 0 : RULES.MIN_BET,
    answerIndex: null,
  }
}
const proxyTable = computed(() => rows.value.find((r) => r.id === proxy.value.tableId) ?? null)
const proxyValid = computed(() => {
  const p = proxy.value
  if (p.answerIndex === null) return false
  const coins = proxyTable.value?.coins ?? 0
  if (coins < RULES.MIN_BET) return Number(p.bet) === 0
  return Number(p.bet) >= RULES.MIN_BET && Number(p.bet) <= coins && Number(p.bet) % RULES.BET_STEP === 0
})
async function submitProxy() {
  const p = { ...proxy.value }
  proxy.value.open = false
  await act(
    () =>
      proxySubmit({
        questionNo: currentQ.value,
        tableId: p.tableId,
        bet: Number(p.bet),
        answerIndex: Number(p.answerIndex),
      }),
    `T${p.tableId} を代理入力しました`,
  )
}
</script>

<template>
  <div class="admin">
    <div v-if="booting" class="muted center" style="padding: 40px">読み込み中…</div>

    <!-- ログイン -->
    <div v-else-if="!isHost" class="login">
      <section class="card pad">
        <h2 style="margin: 0 0 4px">司会用 管理画面</h2>
        <p class="muted small" style="margin-top: 0">Firebase に登録した司会アカウントでログインします。</p>
        <div class="stack">
          <input v-model="email" type="email" placeholder="メールアドレス" autocomplete="username" />
          <input
            v-model="password"
            type="password"
            placeholder="パスワード"
            autocomplete="current-password"
            @keyup.enter="login"
          />
          <button class="btn btn-primary btn-lg" :disabled="busy" @click="login">ログイン</button>
        </div>
        <p v-if="loginError" class="red small" style="white-space: pre-wrap">{{ loginError }}</p>
        <p v-if="uid" class="muted small">
          現在のUID: <code class="uid">{{ uid }}</code>
          <button class="btn btn-ghost mini" @click="copyUid">コピー</button>
        </p>
        <p v-if="uid" class="muted small">
          <button class="btn btn-ghost mini" @click="logout">ログアウト</button>
        </p>
      </section>
    </div>

    <!-- 管理画面 -->
    <template v-else>
      <header class="ahead card">
        <div class="row row-wrap">
          <strong class="gold">司会コンソール</strong>
          <span class="chip">第{{ currentQ }}問 / {{ RULES.QUESTION_COUNT }}</span>
          <span class="chip chip-gold">{{ phaseLabel(phase) }}</span>
          <span class="chip" :class="multiplierFor(currentQ) === 3 ? 'chip-gold' : ''">
            配当{{ multiplierFor(currentQ) }}倍
          </span>
          <span class="chip">送信 {{ submittedCount }} / {{ RULES.TABLE_COUNT }}</span>
          <div class="spacer"></div>
          <a class="btn mini" href="/screen" target="_blank">スクリーンを開く</a>
          <a class="btn mini" href="/qr" target="_blank">QRシート</a>
          <button class="btn mini btn-ghost" @click="logout">ログアウト</button>
        </div>
        <nav class="tabs">
          <button v-for="t in [['flow','進行'],['adjust','補填・演出'],['final','最終順位'],['setup','設定'],['logs','ログ']]"
            :key="t[0]" class="tab" :class="{ on: tab === t[0] }" @click="tab = t[0]">
            {{ t[1] }}
          </button>
        </nav>
      </header>

      <p v-if="msg" class="msg">{{ msg }}</p>

      <!-- ===== 進行タブ ===== -->
      <template v-if="tab === 'flow'">
        <section class="card pad">
          <h3 class="h3">フェーズ操作</h3>
          <div class="row row-wrap">
            <button v-if="phase === 'waiting' && currentQ === 1" class="btn btn-lg" :class="{ 'btn-primary': isOpening }" :disabled="busy"
              @click="act(() => setPreviewQ1(isOpening), isOpening ? '第1問の問題と選択肢を表示しました' : '参加受付（QR）に戻しました')">
              {{ isOpening ? '⓪ 第1問を先に見せる' : '⓪ 参加受付（QR）に戻す' }}
            </button>
            <button class="btn btn-lg" :class="{ 'btn-primary': !isOpening }" :disabled="busy || phase !== 'waiting'"
              @click="act(() => startQuestion(currentQ), `第${currentQ}問の受付を開始しました`)">
              ① 第{{ currentQ }}問 表示・受付開始
            </button>
            <button class="btn btn-lg" :disabled="busy || phase !== 'answering'" @click="tryClose">
              ② 締切
            </button>
            <button class="btn btn-lg" :disabled="busy || phase !== 'closed'"
              @click="act(() => revealAnswer(currentQ), '正解を発表しました')">
              ③ 正解発表
            </button>
            <button class="btn btn-lg" :disabled="busy || phase !== 'revealed' || settled"
              @click="act(() => runSettlement(currentQ), '精算しました')">
              ④ 精算実行
            </button>
            <button class="btn btn-lg" :disabled="busy || phase !== 'settled'"
              @click="act(showRanking, 'ランキングを表示しました')">
              ⑤ ランキング
            </button>
            <button class="btn btn-lg" :disabled="busy || !(phase === 'ranking' || phase === 'settled')"
              @click="act(() => goToNextQuestion(currentQ), isLastQuestion ? '終了しました' : '次の問題へ進みました')">
              {{ isLastQuestion ? '⑥ 終了する' : '⑥ 次の問題へ' }}
            </button>
          </div>

          <div class="row row-wrap" style="margin-top: 14px">
            <button class="btn mini" :disabled="busy || phase !== 'closed'"
              @click="act(reopenAnswering, '受付を再開しました')">
              受付再開
            </button>
            <button class="btn mini" :disabled="busy || !settled"
              @click="act(() => undoSettlement(currentQ), '精算を取り消しました')">
              精算のやり直し
            </button>
            <button class="btn mini" :disabled="busy || phase === 'finished'"
              @click="act(finishGame, '終了にしました')">
              強制終了
            </button>
            <div class="spacer"></div>
            <span class="muted small">緊急時のフェーズ直接変更:</span>
            <select :value="phase" style="width: 150px" @change="act(() => setPhase($event.target.value), 'フェーズを変更しました')">
              <option v-for="p in PHASE_ORDER" :key="p" :value="p">{{ phaseLabel(p) }}（{{ p }}）</option>
            </select>
            <button class="btn mini btn-danger" :disabled="busy" @click="resetStep = 1">リセット</button>
          </div>

          <p class="muted small" style="margin-bottom: 0">
            現在の問題：{{ currentQuestion?.text || '（未設定）' }}
          </p>
        </section>

        <section class="card pad">
          <h3 class="h3">送信状況（回答は司会にだけ見えます）</h3>
          <table class="t">
            <thead>
              <tr>
                <th>T</th>
                <th>テーブル</th>
                <th class="num">所持</th>
                <th>接続</th>
                <th>送信</th>
                <th class="num">賭け金</th>
                <th>回答</th>
                <th class="num">増減</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in rows" :key="r.id" :class="{ pending: !r.sub }">
                <td class="strong">{{ r.id }}</td>
                <td>{{ r.name }}</td>
                <td class="num tabular gold strong">{{ fmt(r.coins) }}</td>
                <td>
                  <span v-if="r.online" class="chip chip-green mini-chip">接続</span>
                  <span v-else-if="r.everSeen" class="chip chip-red mini-chip">切断</span>
                  <span v-else class="chip mini-chip">未入室</span>
                </td>
                <td>
                  <span v-if="r.sub" class="chip chip-green mini-chip">
                    {{ r.sub.isProxy ? '代理' : '送信済' }}
                  </span>
                  <span v-else class="muted">考え中…</span>
                </td>
                <td class="num tabular">
                  {{ r.sub ? fmt(r.sub.bet) : '—' }}
                  <span v-if="r.mismatch" class="red" title="公開用の賭け金と不一致">⚠</span>
                </td>
                <td class="strong">
                  {{ r.sub ? CHOICE_LABELS[r.sub.answerIndex] : '—' }}
                </td>
                <td class="num tabular" :class="r.result ? (r.result.delta >= 0 ? 'green' : 'red') : ''">
                  {{ r.result ? fmtDelta(r.result.delta) : '—' }}
                </td>
                <td>
                  <div class="row">
                    <button class="btn mini" :disabled="busy || !!r.sub" @click="openProxy(r)">代理入力</button>
                    <button class="btn mini btn-danger" :disabled="busy || !r.sub"
                      @click="act(() => cancelSubmission({ questionNo: currentQ, tableId: r.id }), `T${r.id} の送信を取り消しました`)">
                      取消
                    </button>
                    <button class="btn mini btn-ghost" :disabled="busy"
                      @click="act(() => releaseTable(r.id), `T${r.id} の端末紐付けを解除しました`)">
                      端末解除
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-if="pendingTableIds.length && phase === 'answering'" class="muted small">
            未送信：{{ pendingTableIds.map((id) => 'T' + id).join(', ') }}
          </p>
        </section>
      </template>

      <AdminAdjust v-else-if="tab === 'adjust'" :tables="rows" />
      <AdminFinalize v-else-if="tab === 'final'" :tables="rows" />
      <AdminSetup v-else-if="tab === 'setup'" />
      <AdminLogs v-else-if="tab === 'logs'" :logs="logList" />
    </template>

    <!-- 締切の確認 -->
    <ConfirmDialog
      :open="closeConfirm"
      title="未送信のテーブルがあります"
      :message="`未送信：${pendingTableIds.map((id) => 'T' + id).join(', ')}\n締め切りますか？（未送信は100コインを賭けて不正解として精算されます）`"
      confirm-label="締め切る"
      danger
      @confirm="closeConfirm = false; act(closeAnswering, '締め切りました')"
      @cancel="closeConfirm = false"
    />

    <!-- リセット（2段階） -->
    <ConfirmDialog
      :open="resetStep === 1"
      title="ゲームを初期化します"
      message="全テーブルのコインを1,000に戻し、送信・精算結果をすべて削除します。全端末の入室も解除されるため、各テーブルは入り直しが必要です。この操作は取り消せません。"
      confirm-label="続行"
      danger
      @confirm="resetStep = 2"
      @cancel="resetStep = 0"
    />
    <ConfirmDialog
      :open="resetStep === 2"
      title="本当に初期化しますか？"
      message="もう一度確認します。進行中のゲームはすべて失われます。"
      confirm-label="初期化する"
      danger
      @confirm="resetStep = 0; act(resetGame, 'ゲームを初期化しました')"
      @cancel="resetStep = 0"
    />

    <!-- 代理入力 -->
    <div v-if="proxy.open" class="modal-backdrop" @click.self="proxy.open = false">
      <div class="modal">
        <h3 style="margin: 0 0 6px">代理入力：T{{ proxy.tableId }} {{ proxyTable?.name }}</h3>
        <p class="muted small" style="margin-top: 0">
          所持 {{ fmt(proxyTable?.coins ?? 0) }} コイン
          <template v-if="(proxyTable?.coins ?? 0) < RULES.MIN_BET">（賭けられないため賭け金は0です）</template>
        </p>
        <div class="stack">
          <div>
            <div class="muted small">回答</div>
            <div class="row row-wrap">
              <button v-for="i in [0, 1, 2, 3]" :key="i" class="btn"
                :class="{ 'btn-primary': proxy.answerIndex === i }" @click="proxy.answerIndex = i">
                {{ CHOICE_LABELS[i] }}. {{ currentQuestion?.choices?.[i] }}
              </button>
            </div>
          </div>
          <div v-if="(proxyTable?.coins ?? 0) >= RULES.MIN_BET">
            <div class="muted small">賭け金</div>
            <div class="row">
              <button class="btn" @click="proxy.bet = Math.max(RULES.MIN_BET, Number(proxy.bet) - RULES.BET_STEP)">−100</button>
              <input v-model.number="proxy.bet" type="number" :step="RULES.BET_STEP" style="width: 120px; text-align: right" />
              <button class="btn" @click="proxy.bet = Math.min(proxyTable.coins, Number(proxy.bet) + RULES.BET_STEP)">＋100</button>
              <button class="btn" @click="proxy.bet = proxyTable.coins">全額</button>
            </div>
          </div>
        </div>
        <div class="row" style="justify-content: flex-end; margin-top: 18px">
          <button class="btn btn-ghost" @click="proxy.open = false">キャンセル</button>
          <button class="btn btn-primary" :disabled="!proxyValid" @click="submitProxy">送信する</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.admin {
  max-width: 1200px;
  margin: 0 auto;
  padding: 16px 16px 60px;
  display: grid;
  gap: 14px;
}
.login {
  max-width: 460px;
  margin: 60px auto;
}
.pad {
  padding: 16px;
}
.ahead {
  padding: 14px 16px;
  position: sticky;
  top: 0;
  z-index: 20;
}
.tabs {
  display: flex;
  gap: 6px;
  margin-top: 12px;
  flex-wrap: wrap;
}
.tab {
  background: transparent;
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 6px 14px;
  font-weight: 700;
  font-size: 0.9rem;
}
.tab.on {
  background: var(--gold);
  border-color: var(--gold-dim);
  color: #241a00;
}
.h3 {
  margin: 0 0 12px;
  font-size: 1rem;
}
.small {
  font-size: 0.85rem;
}
.mini {
  padding: 6px 10px;
  font-size: 0.82rem;
  border-radius: 9px;
  text-decoration: none;
}
.mini-chip {
  font-size: 0.72rem;
  padding: 2px 8px;
}
.msg {
  margin: 0;
  padding: 10px 14px;
  border-radius: 10px;
  background: var(--panel-2);
  border: 1px solid var(--line);
  font-weight: 700;
}
.t {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.92rem;
}
.t th {
  text-align: left;
  color: var(--muted);
  font-size: 0.78rem;
  padding: 6px 8px;
  border-bottom: 1px solid var(--line);
  white-space: nowrap;
}
.t td {
  padding: 8px;
  border-bottom: 1px solid var(--line);
  vertical-align: middle;
}
.t .num {
  text-align: right;
}
.strong {
  font-weight: 900;
}
tr.pending td {
  background: rgba(255, 93, 108, 0.05);
}
.uid {
  background: var(--bg-2);
  padding: 2px 6px;
  border-radius: 6px;
  font-size: 0.8rem;
}
</style>
