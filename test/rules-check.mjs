// 実機のFirestoreに対して「匿名ユーザー（テーブル端末）に何が許可/拒否されるか」を確認する。
// 成功する書き込みは行わないので、データは残らない。
import { initializeApp } from 'firebase/app'
import { getAuth, signInAnonymously } from 'firebase/auth'
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, serverTimestamp, collection, getDocs,
} from 'firebase/firestore'
import { readFileSync } from 'node:fs'

// .env から Firebase の設定を読む
const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)

const app = initializeApp({
  apiKey: env.VITE_FB_API_KEY,
  authDomain: env.VITE_FB_AUTH_DOMAIN,
  projectId: env.VITE_FB_PROJECT_ID,
  appId: env.VITE_FB_APP_ID,
})
const auth = getAuth(app)
const db = getFirestore(app)

const cred = await signInAnonymously(auth)
console.log('匿名ログイン OK uid=' + cred.user.uid.slice(0, 8) + '…\n')

let pass = 0, fail = 0
async function expectDenied(label, fn) {
  try {
    await fn()
    console.log(`✗ ${label} … 通ってしまった（想定外）`)
    fail++
  } catch (e) {
    const denied = e?.code === 'permission-denied'
    console.log(`${denied ? '✔' : '?'} ${label} … ${denied ? '拒否された（正しい）' : e.code}`)
    denied ? pass++ : fail++
  }
}
async function expectAllowed(label, fn) {
  try {
    await fn()
    console.log(`✔ ${label} … 許可された（正しい）`)
    pass++
  } catch (e) {
    console.log(`✗ ${label} … ${e.code ?? e.message}`)
    fail++
  }
}

console.log('[読み取り]')
await expectAllowed('game/main を読む', () => getDoc(doc(db, 'game', 'main')))
await expectAllowed('tables 一覧を読む', () => getDocs(collection(db, 'tables')))
await expectAllowed('questions 一覧を読む', () => getDocs(collection(db, 'questions')))
await expectDenied('answers/1（正解）を読む', () => getDoc(doc(db, 'answers', '1')))
await expectDenied('config/secret（合言葉）を読む', () => getDoc(doc(db, 'config', 'secret')))
await expectDenied('logs 一覧を読む', () => getDocs(collection(db, 'logs')))
await expectDenied('claims 一覧を読む', () => getDocs(collection(db, 'claims')))

console.log('\n[書き込み（すべて拒否されるべき）]')
await expectDenied('game/main のフェーズを書き換える', () =>
  updateDoc(doc(db, 'game', 'main'), { phase: 'answering' }))
await expectDenied('tables/1 のコインを書き換える', () =>
  updateDoc(doc(db, 'tables', '1'), { coins: 999999 }))
await expectDenied('questions/1 を書き換える', () =>
  setDoc(doc(db, 'questions', '1'), { text: 'hack' }, { merge: true }))
await expectDenied('answers/1 を書き換える', () =>
  setDoc(doc(db, 'answers', '1'), { correctIndex: 0 }))
await expectDenied('settlements/1 を書き換える', () =>
  setDoc(doc(db, 'settlements', '1'), { hacked: true }))
await expectDenied('logs に書き込む', () =>
  setDoc(doc(db, 'logs', 'x'), { type: 'hack' }))
await expectDenied('間違った合言葉で入室する', () =>
  setDoc(doc(db, 'claims', cred.user.uid), {
    tableId: '1', pass: 'definitely-wrong-passphrase', at: serverTimestamp(),
  }))
await expectDenied('合言葉フィールド無しで入室する', () =>
  setDoc(doc(db, 'claims', cred.user.uid), { tableId: '1', at: serverTimestamp() }))
await expectDenied('紐付け無しで送信する', () =>
  setDoc(doc(db, 'submissions', '1', 'items', '1'), {
    questionNo: 1, tableId: '1', bet: 100, answerIndex: 0,
    submittedAt: serverTimestamp(), isProxy: false, uid: cred.user.uid,
  }))
await expectDenied('紐付け無しで公開賭け金を書く', () =>
  setDoc(doc(db, 'publicBets', '1', 'items', '1'), {
    questionNo: 1, tableId: '1', bet: 100, submittedAt: serverTimestamp(),
  }))
await expectDenied('他テーブルのpresenceを書く', () =>
  setDoc(doc(db, 'presence', '2'), { tableId: '2', uid: cred.user.uid, at: serverTimestamp() }))

console.log(`\n結果: ${pass} 件が想定どおり / ${fail} 件が想定外`)
process.exit(fail ? 1 : 0)
