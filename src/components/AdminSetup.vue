<script setup>
import { onMounted, ref, watch } from 'vue'
import { getDoc } from 'firebase/firestore'
import { answerRef, configRef } from '../lib/paths.js'
import {
  initializeData,
  savePassphrase,
  saveQuestion,
  saveTableName,
  setTimeLimit,
} from '../lib/host.js'
import { QUESTION_NOS, RULES, multiplierFor } from '../config.js'
import { CHOICE_LABELS } from '../lib/util.js'
import { game, questions, tables } from '../lib/store.js'

const passphrase = ref('')
const timeLimit = ref(RULES.DEFAULT_TIME_LIMIT_SEC)
const names = ref({})
// テンプレートが即座に参照するので、空の下書きを先に用意しておく
const drafts = ref(
  Object.fromEntries(
    QUESTION_NOS.map((no) => [no, { text: '', choices: ['', '', '', ''], correctIndex: 0 }]),
  ),
)
const loadedAnswers = ref(false)
const msg = ref('')
const busy = ref(false)

async function loadSecrets() {
  const snap = await getDoc(configRef('secret'))
  passphrase.value = snap.exists() ? (snap.data().passphrase ?? '') : ''
  for (const no of QUESTION_NOS) {
    const a = await getDoc(answerRef(no))
    if (a.exists()) drafts.value[no].correctIndex = a.data().correctIndex ?? 0
  }
  loadedAnswers.value = true
  fillDraftsFromQuestions()
}

/** 未入力の下書きだけをFirestoreの内容で埋める（編集中の値は上書きしない） */
function fillDraftsFromQuestions() {
  QUESTION_NOS.forEach((no) => {
    const q = questions.value[String(no)]
    if (!q) return
    const d = drafts.value[no]
    if (!d.text) d.text = q.text ?? ''
    if (d.choices.every((c) => !c)) d.choices = [...(q.choices ?? ['', '', '', ''])]
  })
}

onMounted(loadSecrets)

// 購読が後から届くので、届いたタイミングで反映する
watch(questions, fillDraftsFromQuestions, { immediate: true, deep: true })
watch(
  game,
  (g) => {
    if (g?.timeLimitSec) timeLimit.value = g.timeLimitSec
  },
  { immediate: true },
)

watch(
  tables,
  (list) => {
    list.forEach((t) => {
      if (names.value[t.id] === undefined) names.value[t.id] = t.name ?? `テーブル${t.id}`
    })
  },
  { immediate: true, deep: true },
)

async function run(fn, okMsg) {
  if (busy.value) return
  busy.value = true
  msg.value = ''
  try {
    await fn()
    msg.value = okMsg
  } catch (e) {
    msg.value = `エラー: ${e.message}`
  } finally {
    busy.value = false
  }
}

function saveQ(no) {
  const d = drafts.value[no]
  if (!d.text.trim()) {
    msg.value = '問題文を入力してください'
    return
  }
  if (d.choices.some((c) => !String(c).trim())) {
    msg.value = '選択肢を4つすべて入力してください'
    return
  }
  run(
    () => saveQuestion(no, { text: d.text, choices: d.choices, correctIndex: d.correctIndex }),
    `第${no}問を保存しました`,
  )
}

async function saveAll() {
  busy.value = true
  msg.value = ''
  try {
    for (const no of QUESTION_NOS) {
      const d = drafts.value[no]
      if (!d?.text?.trim()) continue
      await saveQuestion(no, { text: d.text, choices: d.choices, correctIndex: d.correctIndex })
    }
    msg.value = '全問を保存しました'
  } catch (e) {
    msg.value = `エラー: ${e.message}`
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="stack">
    <section class="card pad">
      <h3 class="h3">初期セットアップ</h3>
      <p class="muted small" style="margin-top: 0">
        game / tables / questions / 合言葉 を作ります。既にあるデータは上書きしません。
      </p>
      <div class="row row-wrap">
        <input v-model="passphrase" placeholder="合言葉" style="width: 220px" />
        <button
          class="btn btn-primary"
          :disabled="busy"
          @click="run(async () => { await initializeData({ passphrase }); await loadSecrets() }, '初期セットアップを実行しました')"
        >
          初期データを作成
        </button>
        <button class="btn" :disabled="busy || !passphrase" @click="run(() => savePassphrase(passphrase), '合言葉を保存しました')">
          合言葉だけ保存
        </button>
      </div>
    </section>

    <section class="card pad">
      <h3 class="h3">制限時間（演出用のカウントダウン）</h3>
      <div class="row">
        <input v-model.number="timeLimit" type="number" min="5" max="120" style="width: 100px" />
        <span class="muted">秒</span>
        <button class="btn" :disabled="busy" @click="run(() => setTimeLimit(timeLimit), '保存しました')">
          保存
        </button>
      </div>
    </section>

    <section class="card pad">
      <h3 class="h3">テーブル名</h3>
      <div class="tgrid">
        <div v-for="t in tables" :key="t.id" class="row">
          <span class="tnum">T{{ t.id }}</span>
          <input v-model="names[t.id]" style="flex: 1" />
          <button class="btn" :disabled="busy" @click="run(() => saveTableName(t.id, names[t.id]), `T${t.id} を保存しました`)">
            保存
          </button>
        </div>
      </div>
    </section>

    <section class="card pad">
      <div class="row">
        <h3 class="h3" style="margin: 0">問題（全{{ RULES.QUESTION_COUNT }}問）</h3>
        <div class="spacer"></div>
        <button class="btn btn-primary" :disabled="busy" @click="saveAll">全問まとめて保存</button>
      </div>
      <div v-for="no in QUESTION_NOS" :key="no" class="qcard">
        <div class="row">
          <span class="chip" :class="multiplierFor(no) === 3 ? 'chip-gold' : ''">
            第{{ no }}問 ・ 配当{{ multiplierFor(no) }}倍
          </span>
          <div class="spacer"></div>
          <button class="btn" :disabled="busy" @click="saveQ(no)">保存</button>
        </div>
        <textarea v-model="drafts[no].text" rows="2" placeholder="問題文" style="width: 100%; margin-top: 8px" />
        <div class="cgrid">
          <label v-for="i in [0, 1, 2, 3]" :key="i" class="crow">
            <input
              type="radio"
              :name="`correct-${no}`"
              :value="i"
              :checked="drafts[no].correctIndex === i"
              @change="drafts[no].correctIndex = i"
            />
            <span class="clabel">{{ CHOICE_LABELS[i] }}</span>
            <input v-model="drafts[no].choices[i]" :placeholder="`選択肢${CHOICE_LABELS[i]}`" style="flex: 1" />
          </label>
        </div>
        <div class="muted small">ラジオボタンが正解の選択肢です</div>
      </div>
    </section>

    <p v-if="msg" class="muted" style="margin: 0">{{ msg }}</p>
  </div>
</template>

<style scoped>
.pad {
  padding: 16px;
}
.h3 {
  margin: 0 0 10px;
  font-size: 1rem;
}
.small {
  font-size: 0.85rem;
}
.tgrid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 8px;
}
.tnum {
  font-weight: 900;
  min-width: 2.2em;
}
.qcard {
  margin-top: 14px;
  padding: 14px;
  border-radius: 12px;
  background: var(--bg-2);
  border: 1px solid var(--line);
}
.cgrid {
  display: grid;
  gap: 8px;
  margin-top: 10px;
}
.crow {
  display: flex;
  align-items: center;
  gap: 10px;
}
.clabel {
  font-weight: 900;
  color: var(--gold);
  min-width: 1.2em;
}
</style>
