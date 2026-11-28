// ============================================================
//  Firebase 設定
//  Firebase Console > プロジェクトの設定 > マイアプリ（ウェブ）
//  の firebaseConfig をそのまま貼り付けてください。
//  （Web の apiKey は公開前提の識別子です。秘密情報ではありません）
// ============================================================
// .env で VITE_FB_* を定義すれば上書きできる（node から読み込んでも落ちないようにしている）
const env = (typeof import.meta !== 'undefined' && import.meta.env) || {}

export const firebaseConfig = {
  apiKey: env.VITE_FB_API_KEY || 'REPLACE_ME',
  authDomain: env.VITE_FB_AUTH_DOMAIN || 'REPLACE_ME.firebaseapp.com',
  projectId: env.VITE_FB_PROJECT_ID || 'REPLACE_ME',
  storageBucket: env.VITE_FB_STORAGE_BUCKET || 'REPLACE_ME.firebasestorage.app',
  messagingSenderId: env.VITE_FB_SENDER_ID || 'REPLACE_ME',
  appId: env.VITE_FB_APP_ID || 'REPLACE_ME',
}

// ============================================================
//  ゲーム設定（仕様書 v0.2 + 要決定事項の確定内容）
// ============================================================
export const RULES = {
  TABLE_COUNT: 7, // テーブル数
  QUESTION_COUNT: 7, // 全7問
  INITIAL_COINS: 1000, // 初期コイン
  BET_STEP: 100, // 賭け金の単位
  MIN_BET: 100, // 最低賭け金
  NORMAL_MULTIPLIER: 2, // 第1〜6問の配当
  FINAL_MULTIPLIER: 3, // 第7問（最終問題）の配当
  ZERO_COIN_REWARD: 100, // 0コインのテーブルが正解したときの救済額
  MISSING_BET: 100, // 未送信のまま締め切られた場合の扱い（100を賭けて不正解）
  DEFAULT_TIME_LIMIT_SEC: 20, // カウントダウン（演出用）
  PRESENCE_INTERVAL_MS: 15000, // 端末の生存通知の間隔
  PRESENCE_STALE_MS: 45000, // これを超えたら「切断」表示
}

export const TABLE_IDS = Array.from({ length: RULES.TABLE_COUNT }, (_, i) => String(i + 1))
export const QUESTION_NOS = Array.from({ length: RULES.QUESTION_COUNT }, (_, i) => i + 1)

export function multiplierFor(questionNo) {
  return questionNo === RULES.QUESTION_COUNT ? RULES.FINAL_MULTIPLIER : RULES.NORMAL_MULTIPLIER
}
