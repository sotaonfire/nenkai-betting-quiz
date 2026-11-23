import { RULES } from '../config.js'
import { computeRanks } from './util.js'

/**
 * 1問分の精算を計算する純関数（仕様書 6章）。
 * Firestore に触らないのでそのままテストできる。
 *
 * @param {object} p
 * @param {{id: string, coins: number, correctCount: number}[]} p.tableStates 精算前の状態
 * @param {Record<string, {tableId: string, bet: number, answerIndex: number, isProxy?: boolean}|null>} p.submissions
 * @param {number} p.correctIndex 正解の選択肢
 * @param {number} p.multiplier 配当倍率（第1〜6問=2、第7問=3）
 * @returns {{results: Record<string, object>, correctCounts: Record<string, number>}}
 */
export function computeSettlement({ tableStates, submissions, correctIndex, multiplier }) {
  const results = {}
  const correctCounts = {}
  const beforeRows = []
  const afterRows = []

  for (const t of tableStates) {
    const before = Number(t.coins ?? 0)
    const sub = submissions[t.id] ?? null
    // 他テーブル名義の送信が紛れ込んでいた場合は無効扱いにする
    const valid = !!sub && sub.tableId === t.id

    let bet
    let answerIndex
    let correct
    let delta

    if (before < RULES.MIN_BET) {
      // 賭けられないテーブル（0コイン）。正解なら救済のみ
      bet = 0
      answerIndex = valid ? sub.answerIndex : null
      correct = valid && answerIndex === correctIndex
      delta = correct ? RULES.ZERO_COIN_REWARD : 0
    } else if (!valid) {
      // 未送信のまま締め切られた場合：100を賭けて不正解として扱う
      bet = Math.min(RULES.MISSING_BET, before)
      answerIndex = null
      correct = false
      delta = -bet
    } else {
      bet = Number(sub.bet ?? 0)
      answerIndex = sub.answerIndex
      correct = answerIndex === correctIndex
      delta = correct ? bet * (multiplier - 1) : -bet
    }

    const after = before + delta
    results[t.id] = {
      before,
      bet,
      answerIndex: answerIndex ?? null,
      correct,
      delta,
      after,
      missing: !valid,
      isProxy: valid ? !!sub.isProxy : false,
    }
    correctCounts[t.id] = Number(t.correctCount ?? 0) + (correct ? 1 : 0)
    beforeRows.push({ id: t.id, coins: before })
    afterRows.push({ id: t.id, coins: after })
  }

  const prevRanks = computeRanks(beforeRows)
  const ranks = computeRanks(afterRows)
  for (const t of tableStates) {
    results[t.id].prevRank = prevRanks[t.id]
    results[t.id].rank = ranks[t.id]
  }

  return { results, correctCounts }
}
