export const PHASES = {
  waiting: { label: '開始前', hint: 'QRコードを読み込んで入室してもらいます' },
  answering: { label: '受付中', hint: '賭け金と回答を送信してください' },
  closed: { label: '締切', hint: '締め切りました' },
  revealed: { label: '正解発表', hint: '正解発表中' },
  settled: { label: '精算済み', hint: 'コインの増減を確認してください' },
  ranking: { label: 'ランキング', hint: 'スクリーンをご覧ください' },
  finished: { label: '終了', hint: 'おつかれさまでした' },
}

export const PHASE_ORDER = [
  'waiting',
  'answering',
  'closed',
  'revealed',
  'settled',
  'ranking',
  'finished',
]

export function phaseLabel(phase) {
  return PHASES[phase]?.label ?? phase ?? '-'
}
