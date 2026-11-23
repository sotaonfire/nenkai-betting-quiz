import {
  addDoc,
  collection,
  deleteDoc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore'
import { db, auth } from '../firebase.js'
import { RULES, TABLE_IDS, QUESTION_NOS, multiplierFor } from '../config.js'
import { computeSettlement } from './settlement-core.js'
import {
  answerRef,
  configRef,
  gameRef,
  logsCol,
  publicBetRef,
  publicBetsCol,
  questionRef,
  revealRef,
  settlementRef,
  submissionRef,
  submissionsCol,
  tableRef,
  tablesCol,
} from './paths.js'

const claimsCol = () => collection(db, 'claims')

/** コインの増減は100単位に丸める */
function roundToStep(n) {
  return Math.round(Number(n) / RULES.BET_STEP) * RULES.BET_STEP
}

/** 操作ログを残す */
export async function logAction(type, payload = {}) {
  await addDoc(logsCol(), {
    type,
    at: serverTimestamp(),
    by: auth.currentUser?.uid ?? null,
    ...payload,
  })
}

// ============================================================
//  初期セットアップ
// ============================================================

/** game / tables / config / questions を作る（既存の値は壊さない） */
export async function initializeData({ passphrase }) {
  const batch = writeBatch(db)
  const gameSnap = await getDoc(gameRef())
  if (!gameSnap.exists()) {
    batch.set(gameRef(), {
      phase: 'waiting',
      currentQ: 1,
      timeLimitSec: RULES.DEFAULT_TIME_LIMIT_SEC,
      announcement: '',
      startedAt: null,
      updatedAt: serverTimestamp(),
    })
  }
  for (const id of TABLE_IDS) {
    const snap = await getDoc(tableRef(id))
    if (!snap.exists()) {
      batch.set(tableRef(id), {
        name: `テーブル${id}`,
        coins: RULES.INITIAL_COINS,
        correctCount: 0,
        finalRank: null,
        joinedAt: null,
      })
    }
  }
  for (const no of QUESTION_NOS) {
    const snap = await getDoc(questionRef(no))
    if (!snap.exists()) {
      batch.set(questionRef(no), {
        no,
        text: `第${no}問の問題文（未設定）`,
        choices: ['選択肢A', '選択肢B', '選択肢C', '選択肢D'],
        multiplier: multiplierFor(no),
      })
      batch.set(answerRef(no), { correctIndex: 0 })
    }
  }
  if (passphrase) {
    batch.set(configRef('secret'), { passphrase }, { merge: true })
  }
  await batch.commit()
  await logAction('init', { reason: '初期セットアップ' })
}

export async function savePassphrase(passphrase) {
  await setDoc(configRef('secret'), { passphrase }, { merge: true })
  await logAction('passphrase', { reason: '合言葉を変更' })
}

export async function saveQuestion(no, { text, choices, correctIndex }) {
  await setDoc(
    questionRef(no),
    { no: Number(no), text, choices, multiplier: multiplierFor(Number(no)) },
    { merge: true },
  )
  await setDoc(answerRef(no), { correctIndex: Number(correctIndex) }, { merge: true })
}

export async function saveTableName(tableId, name) {
  await updateDoc(tableRef(tableId), { name })
}

export async function setTimeLimit(sec) {
  await updateDoc(gameRef(), { timeLimitSec: Number(sec), updatedAt: serverTimestamp() })
}

export async function setAnnouncement(text) {
  await updateDoc(gameRef(), { announcement: text ?? '', updatedAt: serverTimestamp() })
}

// ============================================================
//  フェーズ操作
// ============================================================

export async function startQuestion(questionNo) {
  await updateDoc(gameRef(), {
    phase: 'answering',
    currentQ: Number(questionNo),
    startedAt: serverTimestamp(),
    announcement: '',
    updatedAt: serverTimestamp(),
  })
}

export async function closeAnswering() {
  await updateDoc(gameRef(), { phase: 'closed', updatedAt: serverTimestamp() })
}

/** 受付再開。カウントダウンも打ち直す */
export async function reopenAnswering() {
  await updateDoc(gameRef(), {
    phase: 'answering',
    startedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  await logAction('reopen', { reason: '受付再開' })
}

/** answers/{q} の正解を reveals/{q} にコピーして全画面に見せる */
export async function revealAnswer(questionNo) {
  const snap = await getDoc(answerRef(questionNo))
  if (!snap.exists()) throw new Error(`第${questionNo}問の正解が未登録です`)
  const correctIndex = snap.data().correctIndex
  // 正解の公開とフェーズ遷移は同時に反映する（片方だけ成功する状態を作らない）
  const batch = writeBatch(db)
  batch.set(revealRef(questionNo), {
    questionNo: Number(questionNo),
    correctIndex,
    revealedAt: serverTimestamp(),
  })
  batch.update(gameRef(), { phase: 'revealed', updatedAt: serverTimestamp() })
  await batch.commit()
}

export async function showRanking() {
  await updateDoc(gameRef(), { phase: 'ranking', updatedAt: serverTimestamp() })
}

export async function goToNextQuestion(currentQ) {
  const next = Number(currentQ) + 1
  if (next > RULES.QUESTION_COUNT) {
    await updateDoc(gameRef(), { phase: 'finished', updatedAt: serverTimestamp() })
    return
  }
  await updateDoc(gameRef(), {
    phase: 'waiting',
    currentQ: next,
    startedAt: null,
    announcement: '',
    updatedAt: serverTimestamp(),
  })
}

export async function finishGame() {
  await updateDoc(gameRef(), { phase: 'finished', updatedAt: serverTimestamp() })
}

export async function setPhase(phase) {
  await updateDoc(gameRef(), { phase, updatedAt: serverTimestamp() })
}

// ============================================================
//  精算（仕様書 6章）
// ============================================================

/**
 * 1問につき1回だけ実行される。settlements/{q} が既にあれば何もしない。
 * @returns {Promise<{skipped: boolean}>}
 */
export async function runSettlement(questionNo) {
  const q = Number(questionNo)
  const result = await runTransaction(db, async (tx) => {
    const settled = await tx.get(settlementRef(q))
    if (settled.exists()) return { skipped: true }

    const rev = await tx.get(revealRef(q))
    if (!rev.exists()) throw new Error('正解発表がまだ行われていません')
    const correctIndex = rev.data().correctIndex

    const qSnap = await tx.get(questionRef(q))
    const multiplier = qSnap.exists()
      ? (qSnap.data().multiplier ?? multiplierFor(q))
      : multiplierFor(q)

    const tableStates = []
    for (const id of TABLE_IDS) {
      const snap = await tx.get(tableRef(id))
      const d = snap.data() ?? {}
      tableStates.push({ id, coins: Number(d.coins ?? 0), correctCount: Number(d.correctCount ?? 0) })
    }
    const submissions = {}
    for (const id of TABLE_IDS) {
      const snap = await tx.get(submissionRef(q, id))
      submissions[id] = snap.exists() ? snap.data() : null
    }

    const { results, correctCounts } = computeSettlement({
      tableStates,
      submissions,
      correctIndex,
      multiplier,
    })

    for (const id of TABLE_IDS) {
      tx.update(tableRef(id), { coins: results[id].after, correctCount: correctCounts[id] })
    }

    tx.set(settlementRef(q), {
      questionNo: q,
      multiplier,
      correctIndex,
      settledAt: serverTimestamp(),
      results,
    })
    tx.update(gameRef(), { phase: 'settled', updatedAt: serverTimestamp() })
    return { skipped: false }
  })
  return result
}

/** 精算をやり直す（精算結果を消してコインを戻す。誤登録した正解の修正用） */
export async function undoSettlement(questionNo) {
  const q = Number(questionNo)
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(settlementRef(q))
    if (!snap.exists()) throw new Error('この問題はまだ精算されていません')
    const { results } = snap.data()
    const tableSnaps = []
    for (const id of TABLE_IDS) tableSnaps.push(await tx.get(tableRef(id)))
    TABLE_IDS.forEach((id, i) => {
      const r = results[id]
      if (!r) return
      const tdata = tableSnaps[i].data() ?? {}
      // 精算前の絶対値には戻さない。精算後に行ったコイン補填を消さないため、
      // そのときの増減分だけを引き戻す
      const current = Number(tdata.coins ?? 0)
      tx.update(tableRef(id), {
        coins: Math.max(0, current - Number(r.delta ?? 0)),
        correctCount: Math.max(0, Number(tdata.correctCount ?? 0) - (r.correct ? 1 : 0)),
      })
    })
    tx.delete(settlementRef(q))
    // 「締切」まで戻す。正解を直して③正解発表からやり直せるようにする
    tx.update(gameRef(), { phase: 'closed', updatedAt: serverTimestamp() })
  })
  await logAction('resettle', { questionNo: q, reason: '精算のやり直し' })
}

// ============================================================
//  コイン補填・代理入力・送信の取り消し
// ============================================================

export async function adjustCoins({ tableId, delta, reason }) {
  // コインは常に100の倍数に保つ（100未満の端数が出ると賭け金を作れなくなる）
  const amount = roundToStep(delta)
  const after = await runTransaction(db, async (tx) => {
    const snap = await tx.get(tableRef(tableId))
    if (!snap.exists()) throw new Error('テーブルが見つかりません')
    const before = Number(snap.data().coins ?? 0)
    const next = Math.max(0, before + amount)
    tx.update(tableRef(tableId), { coins: next })
    return { before, next }
  })
  await logAction('adjust', {
    tableId: String(tableId),
    before: after.before,
    after: after.next,
    delta: amount,
    reason: reason ?? '',
  })
  return after
}

/** 全テーブルに一律で加算する（復活ボーナス演出用） */
export async function bulkBonus({ delta, reason }) {
  const amount = roundToStep(delta)
  const snap = await getDocs(tablesCol())
  const batch = writeBatch(db)
  const changes = []
  snap.docs.forEach((d) => {
    const before = Number(d.data().coins ?? 0)
    const next = Math.max(0, before + amount)
    changes.push({ tableId: d.id, before, after: next })
    batch.update(tableRef(d.id), { coins: next })
  })
  await batch.commit()
  await logAction('bonus', { delta: amount, reason: reason ?? '', changes })
  return changes
}

/** 司会による代理入力。公開用の賭け金も同時に書く */
export async function proxySubmit({ questionNo, tableId, bet, answerIndex }) {
  const q = Number(questionNo)
  const batch = writeBatch(db)
  batch.set(submissionRef(q, tableId), {
    questionNo: q,
    tableId: String(tableId),
    bet: Number(bet),
    answerIndex: Number(answerIndex),
    submittedAt: serverTimestamp(),
    isProxy: true,
    uid: auth.currentUser?.uid ?? null,
  })
  batch.set(publicBetRef(q, tableId), {
    questionNo: q,
    tableId: String(tableId),
    bet: Number(bet),
    submittedAt: serverTimestamp(),
  })
  await batch.commit()
  await logAction('proxy', {
    questionNo: q,
    tableId: String(tableId),
    bet: Number(bet),
    answerIndex: Number(answerIndex),
    reason: '代理入力',
  })
}

/** 送信の取り消し（再送信させる） */
export async function cancelSubmission({ questionNo, tableId, reason }) {
  const q = Number(questionNo)
  const batch = writeBatch(db)
  batch.delete(submissionRef(q, tableId))
  batch.delete(publicBetRef(q, tableId))
  await batch.commit()
  await logAction('cancel', {
    questionNo: q,
    tableId: String(tableId),
    reason: reason ?? '送信の取り消し',
  })
}

// ============================================================
//  最終順位の確定
// ============================================================

/** @param {Record<string, number>} rankMap tableId -> 順位 */
export async function setFinalRanks(rankMap) {
  const batch = writeBatch(db)
  Object.entries(rankMap).forEach(([tableId, rank]) => {
    batch.set(tableRef(tableId), { finalRank: rank === null ? null : Number(rank) }, { merge: true })
  })
  await batch.commit()
  await logAction('finalize', { reason: '最終順位の確定', rankMap })
}

// ============================================================
//  リセット
// ============================================================

export async function resetGame() {
  // 送信・公開賭け金・正解発表・精算結果を全問分消す
  for (const no of QUESTION_NOS) {
    const [subs, bets] = await Promise.all([getDocs(submissionsCol(no)), getDocs(publicBetsCol(no))])
    const batch = writeBatch(db)
    subs.docs.forEach((d) => batch.delete(d.ref))
    bets.docs.forEach((d) => batch.delete(d.ref))
    batch.delete(revealRef(no))
    batch.delete(settlementRef(no))
    await batch.commit()
  }
  const batch = writeBatch(db)
  for (const id of TABLE_IDS) {
    batch.set(
      tableRef(id),
      { coins: RULES.INITIAL_COINS, correctCount: 0, finalRank: null },
      { merge: true },
    )
  }
  batch.update(gameRef(), {
    phase: 'waiting',
    currentQ: 1,
    startedAt: null,
    announcement: '',
    updatedAt: serverTimestamp(),
  })
  await batch.commit()
  await logAction('reset', { reason: 'ゲームの初期化' })
}

/** テーブルの端末紐付けを解除する（別の端末で入り直させたいとき用） */
export async function releaseTable(tableId) {
  const snap = await getDocs(query(claimsCol(), where('tableId', '==', String(tableId))))
  await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)))
  await logAction('release', { tableId: String(tableId), reason: '端末の紐付け解除' })
  return snap.size
}
