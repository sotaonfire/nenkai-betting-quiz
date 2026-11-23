import { collection, doc } from 'firebase/firestore'
import { db } from '../firebase.js'

export const gameRef = () => doc(db, 'game', 'main')
export const tablesCol = () => collection(db, 'tables')
export const tableRef = (tableId) => doc(db, 'tables', String(tableId))
export const questionsCol = () => collection(db, 'questions')
export const questionRef = (q) => doc(db, 'questions', String(q))
export const answerRef = (q) => doc(db, 'answers', String(q))
export const revealRef = (q) => doc(db, 'reveals', String(q))
export const settlementRef = (q) => doc(db, 'settlements', String(q))
export const settlementsCol = () => collection(db, 'settlements')
export const submissionsCol = (q) => collection(db, 'submissions', String(q), 'items')
export const submissionRef = (q, tableId) =>
  doc(db, 'submissions', String(q), 'items', String(tableId))
export const publicBetsCol = (q) => collection(db, 'publicBets', String(q), 'items')
export const publicBetRef = (q, tableId) =>
  doc(db, 'publicBets', String(q), 'items', String(tableId))
export const claimRef = (uid) => doc(db, 'claims', uid)
export const presenceCol = () => collection(db, 'presence')
export const presenceRef = (tableId) => doc(db, 'presence', String(tableId))
export const logsCol = () => collection(db, 'logs')
export const configRef = (name) => doc(db, 'config', name)
