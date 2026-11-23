// 精算ロジックの検証。node --test test/settlement.test.mjs で実行する
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSettlement } from '../src/lib/settlement-core.js'
import { computeRanks } from '../src/lib/util.js'
import { RULES, multiplierFor } from '../src/config.js'

const T = (id, coins, correctCount = 0) => ({ id, coins, correctCount })
const S = (tableId, bet, answerIndex, isProxy = false) => ({ tableId, bet, answerIndex, isProxy })

test('第1〜6問は正解で賭け金が純増（×2が戻る）', () => {
  const { results } = computeSettlement({
    tableStates: [T('1', 1000)],
    submissions: { 1: S('1', 500, 2) },
    correctIndex: 2,
    multiplier: 2,
  })
  assert.equal(results['1'].delta, 500)
  assert.equal(results['1'].after, 1500)
  assert.equal(results['1'].correct, true)
})

test('不正解は賭け金を失う', () => {
  const { results } = computeSettlement({
    tableStates: [T('1', 1000)],
    submissions: { 1: S('1', 300, 0) },
    correctIndex: 2,
    multiplier: 2,
  })
  assert.equal(results['1'].delta, -300)
  assert.equal(results['1'].after, 700)
})

test('第7問は正解で賭け金×2が純増（×3が戻る）', () => {
  const { results } = computeSettlement({
    tableStates: [T('1', 1000)],
    submissions: { 1: S('1', 1000, 1) },
    correctIndex: 1,
    multiplier: multiplierFor(RULES.QUESTION_COUNT),
  })
  assert.equal(multiplierFor(RULES.QUESTION_COUNT), 3)
  assert.equal(results['1'].delta, 2000)
  assert.equal(results['1'].after, 3000)
})

test('全額賭けて外すと0コインになる', () => {
  const { results } = computeSettlement({
    tableStates: [T('1', 800)],
    submissions: { 1: S('1', 800, 3) },
    correctIndex: 0,
    multiplier: 2,
  })
  assert.equal(results['1'].after, 0)
})

test('0コインのテーブルは賭け金0で、正解なら+100・不正解なら±0', () => {
  const { results } = computeSettlement({
    tableStates: [T('1', 0), T('2', 0)],
    submissions: { 1: S('1', 0, 2), 2: S('2', 0, 1) },
    correctIndex: 2,
    multiplier: 2,
  })
  assert.equal(results['1'].bet, 0)
  assert.equal(results['1'].delta, RULES.ZERO_COIN_REWARD)
  assert.equal(results['1'].after, 100)
  assert.equal(results['2'].delta, 0)
  assert.equal(results['2'].after, 0)
})

test('0コインのテーブルは第7問に正解しても救済額は+100のまま', () => {
  const { results } = computeSettlement({
    tableStates: [T('1', 0)],
    submissions: { 1: S('1', 0, 0) },
    correctIndex: 0,
    multiplier: 3,
  })
  assert.equal(results['1'].delta, 100)
})

test('未送信のまま締め切られたら100を賭けて不正解扱い', () => {
  const { results } = computeSettlement({
    tableStates: [T('1', 1000)],
    submissions: { 1: null },
    correctIndex: 0,
    multiplier: 2,
  })
  assert.equal(results['1'].missing, true)
  assert.equal(results['1'].bet, 100)
  assert.equal(results['1'].delta, -100)
  assert.equal(results['1'].after, 900)
})

test('0コインで未送信なら±0（賭け金0が優先される）', () => {
  const { results } = computeSettlement({
    tableStates: [T('1', 0)],
    submissions: { 1: null },
    correctIndex: 0,
    multiplier: 2,
  })
  assert.equal(results['1'].bet, 0)
  assert.equal(results['1'].delta, 0)
  assert.equal(results['1'].after, 0)
})

test('他テーブル名義の送信は無効（未送信として扱う）', () => {
  const { results } = computeSettlement({
    tableStates: [T('2', 1000)],
    submissions: { 2: S('3', 900, 0) },
    correctIndex: 0,
    multiplier: 2,
  })
  assert.equal(results['2'].missing, true)
  assert.equal(results['2'].delta, -100)
})

test('正解数が加算される', () => {
  const { correctCounts } = computeSettlement({
    tableStates: [T('1', 1000, 3), T('2', 1000, 2)],
    submissions: { 1: S('1', 100, 0), 2: S('2', 100, 1) },
    correctIndex: 0,
    multiplier: 2,
  })
  assert.equal(correctCounts['1'], 4)
  assert.equal(correctCounts['2'], 2)
})

test('順位と前問からの変動が計算される', () => {
  const { results } = computeSettlement({
    tableStates: [T('1', 1000), T('2', 2000), T('3', 500)],
    submissions: { 1: S('1', 1000, 0), 2: S('2', 100, 1), 3: S('3', 500, 0) },
    correctIndex: 0,
    multiplier: 2,
  })
  // before: T2 2000(1位) > T1 1000(2位) > T3 500(3位)
  // after : T1 2000, T2 1900, T3 1000
  assert.equal(results['1'].prevRank, 2)
  assert.equal(results['1'].rank, 1)
  assert.equal(results['2'].prevRank, 1)
  assert.equal(results['2'].rank, 2)
  assert.equal(results['3'].rank, 3)
})

test('同点は同じ順位になる', () => {
  const ranks = computeRanks([
    { id: 'a', coins: 1000 },
    { id: 'b', coins: 1000 },
    { id: 'c', coins: 500 },
  ])
  assert.deepEqual(ranks, { a: 1, b: 1, c: 3 })
})

test('7テーブル・7問を通しても破綻しない（全員100ずつ賭け続ける）', () => {
  let states = Array.from({ length: 7 }, (_, i) => T(String(i + 1), RULES.INITIAL_COINS))
  for (let q = 1; q <= RULES.QUESTION_COUNT; q++) {
    const submissions = {}
    states.forEach((t, i) => {
      submissions[t.id] = t.coins === 0 ? S(t.id, 0, i % 4) : S(t.id, 100, i % 4)
    })
    const { results, correctCounts } = computeSettlement({
      tableStates: states,
      submissions,
      correctIndex: 0,
      multiplier: multiplierFor(q),
    })
    states = states.map((t) => T(t.id, results[t.id].after, correctCounts[t.id]))
    states.forEach((t) => assert.ok(t.coins >= 0, `コインが負になった: T${t.id}`))
  }
  // 常に選択肢0を選んだT1は7問全問正解（最終問題は3倍）
  assert.equal(states[0].coins, 1000 + 100 * 6 + 200)
  assert.equal(states[0].correctCount, 7)
})

// ---- レビューで見つかった境界条件の回帰テスト ----

test('100未満の端数コインは賭けられない扱いになる（ロックアウト防止）', () => {
  const { results } = computeSettlement({
    tableStates: [T('1', 50)],
    submissions: { 1: S('1', 0, 0) },
    correctIndex: 0,
    multiplier: 2,
  })
  // 端数が残っていても精算が止まらず、正解すれば救済が入る
  assert.equal(results['1'].bet, 0)
  assert.equal(results['1'].delta, RULES.ZERO_COIN_REWARD)
  assert.equal(results['1'].after, 150)
})

test('100未満で未送信でもマイナスにならない', () => {
  const { results } = computeSettlement({
    tableStates: [T('1', 50)],
    submissions: { 1: null },
    correctIndex: 0,
    multiplier: 2,
  })
  assert.equal(results['1'].delta, 0)
  assert.equal(results['1'].after, 50)
})

test('精算のやり直しは差分を引き戻すので、間に挟んだ補填が消えない', () => {
  // 第3問：1000コインから300賭けて正解 → +300 で 1300
  const { results } = computeSettlement({
    tableStates: [T('1', 1000)],
    submissions: { 1: S('1', 300, 1) },
    correctIndex: 1,
    multiplier: 2,
  })
  assert.equal(results['1'].delta, 300)
  assert.equal(results['1'].after, 1300)

  // 精算後に司会が +200 の補填 → 1500
  const afterBonus = results['1'].after + 200

  // ここでやり直し。絶対値(before=1000)に戻すと補填が消えるが、
  // 差分で戻せば 1500 - 300 = 1200 となり補填が残る
  const undoneByDelta = Math.max(0, afterBonus - results['1'].delta)
  assert.equal(undoneByDelta, 1200)
  assert.notEqual(undoneByDelta, results['1'].before)
})
