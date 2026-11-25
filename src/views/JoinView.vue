<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ensureAnonymousUser } from '../firebase.js'
import { startBaseSubscriptions, tables } from '../lib/store.js'
import { currentClaim, joinTable } from '../lib/player.js'
import { RULES, TABLE_IDS } from '../config.js'

const route = useRoute()
const router = useRouter()

const booting = ref(true)
const tableId = ref('')
const passphrase = ref('')
const error = ref('')
const busy = ref(false)

const tableName = (id) => tables.value.find((t) => t.id === id)?.name ?? `テーブル${id}`
const canJoin = computed(() => !!tableId.value && passphrase.value.trim().length > 0)

onMounted(async () => {
  const fromQr = route.query.t ? String(route.query.t) : ''
  if (route.query.released) error.value = '入室が解除されました。もう一度テーブルを選んで入室してください'
  try {
    await ensureAnonymousUser()
    startBaseSubscriptions()
    const claimed = await currentClaim()
    if (claimed && (!fromQr || fromQr === claimed)) {
      router.replace('/play')
      return
    }
    tableId.value = fromQr && TABLE_IDS.includes(fromQr) ? fromQr : claimed || ''
  } catch (e) {
    // 通信が不安定でも入室フォームは出す（合言葉の送信時に再試行される）
    tableId.value = fromQr && TABLE_IDS.includes(fromQr) ? fromQr : ''
    error.value = '接続が不安定です。合言葉を入れて入室をお試しください'
  } finally {
    booting.value = false
  }
})

async function join() {
  if (!canJoin.value || busy.value) return
  busy.value = true
  error.value = ''
  try {
    await joinTable({ tableId: tableId.value, passphrase: passphrase.value.trim() })
    router.replace('/play')
  } catch (e) {
    error.value = e.message || '入室に失敗しました'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="macau">
    <div class="wrap">
      <div v-if="booting" class="boot"><span class="dots"><i></i><i></i><i></i></span></div>

      <template v-else>
        <header class="hero">
          <div class="suits" aria-hidden="true"><span>♠</span><span class="r">♥</span><span class="r">♦</span><span>♣</span></div>
          <div class="logo latin foil">CWD</div>
          <div class="logo-sub latin">CASINO</div>
          <div class="rule"><span class="rule-gem"></span></div>
          <div class="event display">2026 忘年会 BETTING QUIZ</div>
        </header>

        <section class="form">
          <div class="lbl-row">
            <span class="kicker">SELECT TABLE ・ テーブルを選択</span>
            <span class="muted tiny">1テーブル1台</span>
          </div>
          <div class="grid">
            <button
              v-for="id in TABLE_IDS"
              :key="id"
              class="tbtn"
              :class="{ on: tableId === id }"
              @click="tableId = id"
            >
              <span class="tnum latin">{{ id }}</span>
              <span class="tname">{{ tableName(id) }}</span>
            </button>
          </div>

          <span class="kicker">PASSPHRASE ・ 合言葉</span>
          <input
            v-model="passphrase"
            type="text"
            inputmode="text"
            autocapitalize="off"
            autocomplete="off"
            placeholder="司会から伝えられた合言葉"
            class="pass"
            @keyup.enter="join"
          />

          <p v-if="error" class="err">{{ error }}</p>

          <div class="start muted">
            持ち点 <span class="num gold">{{ RULES.INITIAL_COINS.toLocaleString('ja-JP') }}</span> コイン ・ 全{{ RULES.QUESTION_COUNT }}問・4択
          </div>
          <button class="btn btn-primary btn-lg btn-block" :disabled="!canJoin || busy" @click="join">
            {{ busy ? '入室中…' : tableId ? 'テーブル' + tableId + ' で入室する' : 'テーブルを選んでください' }}
          </button>
        </section>

        <p class="muted center small">
          この端末がテーブルの回答端末になります。<br />間違えた場合は司会に声をかけてください。
        </p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.wrap {
  max-width: 480px;
  min-height: 100vh;
  margin: 0 auto;
  padding: calc(28px + env(safe-area-inset-top)) 22px calc(28px + env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  gap: 22px;
}
.boot {
  flex: 1;
  display: grid;
  place-items: center;
}
.hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  margin: 24px 0 8px;
}
.suits {
  display: flex;
  gap: 16px;
  font-family: serif;
  font-size: 20px;
}
.suits .r {
  color: var(--red);
}
.logo {
  font-weight: 900;
  font-size: 84px;
  line-height: 0.9;
  letter-spacing: 0.04em;
}
.logo-sub {
  font-weight: 700;
  font-size: 20px;
  letter-spacing: 0.62em;
  margin-right: -0.62em;
  color: var(--gold);
}
.rule {
  width: 220px;
  margin-top: 6px;
}
.event {
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.22em;
}
.form {
  display: grid;
  gap: 12px;
}
.lbl-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}
.tiny {
  font-size: 11px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  margin-bottom: 8px;
}
.tbtn {
  min-height: 72px;
  border-radius: 12px;
  border: 1px solid rgba(242, 201, 106, 0.3);
  background: rgba(0, 0, 0, 0.4);
  color: var(--fg);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  padding: 6px 4px;
  transition: background 0.15s, border-color 0.15s;
}
.tbtn.on {
  background: linear-gradient(180deg, var(--gold-hi), #c8923a);
  border-color: #fff0b8;
  color: var(--gold-ink);
}
.tnum {
  font-weight: 900;
  font-size: 26px;
  line-height: 1;
}
.tname {
  font-size: 10px;
  font-weight: 700;
  line-height: 1.2;
  text-align: center;
  opacity: 0.8;
}
.pass {
  width: 100%;
  height: 52px;
  font-size: 17px;
  font-weight: 700;
}
.err {
  margin: 0;
  padding: 10px 14px;
  border-radius: 10px;
  background: rgba(255, 90, 112, 0.1);
  border: 1px solid rgba(255, 90, 112, 0.35);
  color: var(--red-hi);
  font-size: 13px;
  font-weight: 700;
}
.start {
  text-align: center;
  font-size: 13px;
  margin-top: 6px;
}
.start .num {
  font-size: 16px;
  font-weight: 600;
}
.small {
  font-size: 12px;
  line-height: 1.8;
  margin: 0;
}
</style>
