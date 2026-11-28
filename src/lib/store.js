import { ref, computed, watch, effectScope } from 'vue'
import { onSnapshot, query, orderBy, limit, disableNetwork, enableNetwork } from 'firebase/firestore'
import {
  gameRef,
  tablesCol,
  questionsCol,
  revealRef,
  settlementRef,
  publicBetsCol,
  submissionsCol,
  submissionRef,
  presenceCol,
  logsCol,
} from './paths.js'
import { TABLE_IDS } from '../config.js'
import { db } from '../firebase.js'

// ---------------- 共通で購読する状態 ----------------
export const game = ref(null)
export const tables = ref([])
export const questions = ref({})
export const reveal = ref(null)
export const settlement = ref(null)
export const publicBets = ref({})
export const offline = ref(false)
export const loaded = ref(false)
export const lastSyncAt = ref(0)

export const phase = computed(() => game.value?.phase ?? 'waiting')
export const currentQ = computed(() => game.value?.currentQ ?? 1)
export const currentQuestion = computed(() => questions.value[String(currentQ.value)] ?? null)
/** 第1問の待機中に、参加受付（QR・ルール）を出している状態。司会が問題を先出しすると false */
export const isOpening = computed(
  () => phase.value === 'waiting' && currentQ.value === 1 && !game.value?.previewQ1,
)
export const tableMap = computed(() => Object.fromEntries(tables.value.map((t) => [t.id, t])))

let baseStarted = false

// コンポーネントのライフサイクル中に呼ばれても watch が巻き取られないよう、
// 独立した effectScope の中で購読を張る（アンマウントで止まらないようにする）
const baseScope = effectScope(true)

/** ゲーム状態・テーブル・問題の購読を開始する（全画面共通） */
export function startBaseSubscriptions() {
  if (baseStarted) return
  baseStarted = true
  baseScope.run(() => setupBaseSubscriptions())
}

function setupBaseSubscriptions() {
  onSnapshot(gameRef(), { includeMetadataChanges: true }, (snap) => {
    offline.value = snap.metadata.fromCache
    if (!snap.metadata.fromCache) lastSyncAt.value = Date.now()
    game.value = snap.exists() ? { id: snap.id, ...snap.data() } : null
    loaded.value = true
  })

  onSnapshot(tablesCol(), (snap) => {
    tables.value = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => Number(a.id) - Number(b.id))
  })

  onSnapshot(questionsCol(), (snap) => {
    const next = {}
    snap.docs.forEach((d) => {
      next[d.id] = { id: d.id, ...d.data() }
    })
    questions.value = next
  })

  // 現在の問題に紐づくドキュメントは問題が変わるたびに購読を張り替える
  let stopReveal = null
  let stopSettlement = null
  let stopBets = null
  watch(
    currentQ,
    (q) => {
      stopReveal?.()
      stopSettlement?.()
      stopBets?.()
      reveal.value = null
      settlement.value = null
      publicBets.value = {}
      if (!q) return
      stopReveal = onSnapshot(revealRef(q), (s) => {
        reveal.value = s.exists() ? s.data() : null
      })
      stopSettlement = onSnapshot(settlementRef(q), (s) => {
        settlement.value = s.exists() ? s.data() : null
      })
      stopBets = onSnapshot(publicBetsCol(q), (s) => {
        const next = {}
        s.docs.forEach((d) => {
          next[d.id] = d.data()
        })
        publicBets.value = next
      })
    },
    { immediate: true },
  )

  startConnectionWatchdog()
}

// ---------------- 接続の見張り ----------------
// スマホがスリープやバックグラウンドから復帰したとき、websocketが切られたままで
// 古い状態が残ることがある。復帰時にネットワークを張り直して強制的に再同期する。
let watchdogStarted = false

function startConnectionWatchdog() {
  if (watchdogStarted || typeof document === 'undefined') return
  watchdogStarted = true

  let hiddenAt = 0
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now()
      return
    }
    const hiddenFor = hiddenAt ? Date.now() - hiddenAt : 0
    if (offline.value || hiddenFor > 10000) forceReconnect()
  })
  window.addEventListener('online', () => forceReconnect())
}

let reconnecting = false

/** Firestoreの接続を張り直す（リスナーはそのまま再同期される） */
export async function forceReconnect() {
  if (reconnecting) return
  reconnecting = true
  try {
    await disableNetwork(db)
    await enableNetwork(db)
  } catch {
    /* 失敗しても次のきっかけで再試行する */
  } finally {
    reconnecting = false
  }
}

/** 送信済みテーブル数 */
export const submittedCount = computed(() => Object.keys(publicBets.value).length)
export const pendingTableIds = computed(() =>
  TABLE_IDS.filter((id) => !publicBets.value[id]),
)

// ---------------- 回答端末：自分の送信だけを購読 ----------------
export function useMySubmission(tableIdRef) {
  const mySubmission = ref(null)
  let stop = null
  watch(
    [tableIdRef, currentQ],
    ([tableId, q]) => {
      stop?.()
      mySubmission.value = null
      if (!tableId || !q) return
      stop = onSnapshot(
        submissionRef(q, tableId),
        (s) => {
          mySubmission.value = s.exists() ? s.data() : null
        },
        () => {
          mySubmission.value = null
        },
      )
    },
    { immediate: true },
  )
  return mySubmission
}

// ---------------- 入室状況（スクリーン用） ----------------
export function usePresence() {
  const presence = ref({})
  onSnapshot(presenceCol(), (snap) => {
    const next = {}
    snap.docs.forEach((d) => {
      next[d.id] = d.data()
    })
    presence.value = next
  })
  return presence
}

// ---------------- 司会画面：全テーブルの送信内容と接続状況 ----------------
export const hostSubmissions = ref({})
export const hostPresence = ref({})
export const hostLogs = ref([])

let hostStarted = false
const hostScope = effectScope(true)

export function startHostSubscriptions() {
  if (hostStarted) return
  hostStarted = true
  hostScope.run(() => setupHostSubscriptions())
}

function setupHostSubscriptions() {
  let stopSubs = null
  watch(
    currentQ,
    (q) => {
      stopSubs?.()
      hostSubmissions.value = {}
      if (!q) return
      stopSubs = onSnapshot(submissionsCol(q), (snap) => {
        const next = {}
        snap.docs.forEach((d) => {
          next[d.id] = d.data()
        })
        hostSubmissions.value = next
      })
    },
    { immediate: true },
  )

  onSnapshot(presenceCol(), (snap) => {
    const next = {}
    snap.docs.forEach((d) => {
      next[d.id] = d.data()
    })
    hostPresence.value = next
  })

  onSnapshot(query(logsCol(), orderBy('at', 'desc'), limit(50)), (snap) => {
    hostLogs.value = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  })
}
