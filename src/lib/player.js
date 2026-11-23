import { getDoc, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore'
import { db, auth, ensureAnonymousUser } from '../firebase.js'
import { claimRef, presenceRef, publicBetRef, submissionRef } from './paths.js'
import { RULES } from '../config.js'

const LS_TABLE = 'bq.tableId'

export function rememberedTableId() {
  try {
    return localStorage.getItem(LS_TABLE) || null
  } catch {
    return null
  }
}

function remember(tableId) {
  try {
    localStorage.setItem(LS_TABLE, String(tableId))
  } catch {
    /* プライベートモードなどで失敗しても動作に影響させない */
  }
}

/**
 * ログイン済み端末に紐付いているテーブルIDを返す（未入室なら null）。
 * 通信エラーで読めなかった場合は、前回入室したテーブルIDで代用する。
 * （実際の権限はセキュリティルール側の claims で判定されるので、
 *   ここで誤った値を使っても他テーブルとして送信できてしまうことはない）
 */
export async function currentClaim() {
  const user = await ensureAnonymousUser()
  try {
    const snap = await getDoc(claimRef(user.uid))
    if (!snap.exists()) return null
    const tableId = snap.data().tableId
    remember(tableId)
    return tableId
  } catch (e) {
    if (e?.code === 'permission-denied') return null
    return rememberedTableId()
  }
}

/**
 * 合言葉を照合してテーブルに入室する。
 * 合言葉が違う場合は permission-denied になるので、わかりやすい文言に変換する。
 */
export async function joinTable({ tableId, passphrase }) {
  const user = await ensureAnonymousUser()
  try {
    await setDoc(claimRef(user.uid), {
      tableId: String(tableId),
      pass: String(passphrase),
      at: serverTimestamp(),
    })
  } catch (e) {
    if (e?.code === 'permission-denied') {
      throw new Error('合言葉が違います')
    }
    throw e
  }
  remember(tableId)
  await touchPresence(tableId)
  return String(tableId)
}

/** 端末が生きていることを司会画面に伝える */
export async function touchPresence(tableId) {
  if (!auth.currentUser || !tableId) return
  try {
    await setDoc(presenceRef(tableId), {
      tableId: String(tableId),
      uid: auth.currentUser.uid,
      at: serverTimestamp(),
    })
  } catch {
    /* 接続が切れているときは次回に任せる */
  }
}

export function startPresenceHeartbeat(getTableId) {
  touchPresence(getTableId())
  const timer = setInterval(() => touchPresence(getTableId()), RULES.PRESENCE_INTERVAL_MS)
  return () => clearInterval(timer)
}

/**
 * 賭け金と回答を送信する。submissions と publicBets を同時に書き込む。
 * 送信後は更新できない（ルール側でロック）。
 */
export async function submitAnswer({ questionNo, tableId, bet, answerIndex }) {
  const user = await ensureAnonymousUser()
  const q = Number(questionNo)
  const batch = writeBatch(db)
  batch.set(submissionRef(q, tableId), {
    questionNo: q,
    tableId: String(tableId),
    bet: Number(bet),
    answerIndex: Number(answerIndex),
    submittedAt: serverTimestamp(),
    isProxy: false,
    uid: user.uid,
  })
  batch.set(publicBetRef(q, tableId), {
    questionNo: q,
    tableId: String(tableId),
    bet: Number(bet),
    submittedAt: serverTimestamp(),
  })
  try {
    await batch.commit()
  } catch (e) {
    if (e?.code === 'permission-denied') {
      throw new Error('送信できませんでした。受付が終了しているか、既に送信済みです')
    }
    throw e
  }
}

/**
 * 賭け金の入力値が送信可能か判定する。
 * 所持が最低賭け金に届かない場合は 0 のみ（= 賭けられない）。
 * 0ちょうどだけでなく100未満全体を見るのは、補填ミスなどで
 * 100未満になったテーブルが「賭けられないのに0も送れない」状態で
 * ロックされるのを防ぐため。
 */
export function validateBet(bet, coins) {
  if (coins < RULES.MIN_BET) return bet === 0
  return (
    Number.isInteger(bet) &&
    bet >= RULES.MIN_BET &&
    bet <= coins &&
    bet % RULES.BET_STEP === 0
  )
}
