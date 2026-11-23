/** 1,000 のように3桁区切りで表示する */
export function fmt(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '-'
  return Number(n).toLocaleString('ja-JP')
}

/** +300 / -100 のように符号付きで表示する */
export function fmtDelta(n) {
  if (n === null || n === undefined) return '-'
  if (n > 0) return `+${fmt(n)}`
  if (n < 0) return `-${fmt(Math.abs(n))}`
  return '±0'
}

/**
 * コイン数の多い順に順位を付ける。同点は同じ順位になる（1,2,2,4...）
 * @param {{id: string, coins: number}[]} rows
 * @returns {Record<string, number>} tableId -> 順位
 */
export function computeRanks(rows) {
  const sorted = [...rows].sort((a, b) => b.coins - a.coins)
  const ranks = {}
  let lastCoins = null
  let lastRank = 0
  sorted.forEach((row, i) => {
    if (row.coins === lastCoins) {
      ranks[row.id] = lastRank
    } else {
      ranks[row.id] = i + 1
      lastRank = i + 1
      lastCoins = row.coins
    }
  })
  return ranks
}

export const CHOICE_LABELS = ['A', 'B', 'C', 'D']

export function toMillis(ts) {
  if (!ts) return 0
  if (typeof ts.toMillis === 'function') return ts.toMillis()
  if (ts.seconds) return ts.seconds * 1000
  return 0
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}
