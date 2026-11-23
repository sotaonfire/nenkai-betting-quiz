<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ensureAnonymousUser } from '../firebase.js'
import { startBaseSubscriptions, tables } from '../lib/store.js'
import { currentClaim, joinTable } from '../lib/player.js'
import { TABLE_IDS } from '../config.js'

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
  <div class="wrap">
    <div v-if="booting" class="muted center">読み込み中…</div>

    <template v-else>
      <header class="head">
        <div class="suits" aria-hidden="true">♠ ♥ ♦ ♣</div>
        <div class="title display foil">CWD CASINO</div>
        <div class="rule rule-mark"></div>
        <div class="muted">テーブルを選んで合言葉を入力してください</div>
      </header>

      <section class="card pad">
        <div class="label">テーブル</div>
        <div class="grid">
          <button
            v-for="id in TABLE_IDS"
            :key="id"
            class="btn tbtn"
            :class="{ on: tableId === id }"
            @click="tableId = id"
          >
            <span class="tnum display">T{{ id }}</span>
            <span class="tname">{{ tableName(id) }}</span>
          </button>
        </div>

        <div class="label" style="margin-top: 18px">合言葉</div>
        <input
          v-model="passphrase"
          type="text"
          inputmode="text"
          autocapitalize="off"
          autocomplete="off"
          placeholder="司会から伝えられた合言葉"
          style="width: 100%"
          @keyup.enter="join"
        />

        <p v-if="error" class="red" style="margin: 12px 0 0">{{ error }}</p>

        <button
          class="btn btn-primary btn-lg btn-block"
          style="margin-top: 18px"
          :disabled="!canJoin || busy"
          @click="join"
        >
          {{ busy ? '入室中…' : '入室する' }}
        </button>
      </section>

      <p class="muted center small">
        この端末がテーブルの回答端末になります。<br />間違えた場合は司会に声をかけてください。
      </p>
    </template>
  </div>
</template>

<style scoped>
.wrap {
  max-width: 520px;
  margin: 0 auto;
  padding: 24px 16px 70px;
  display: grid;
  gap: 20px;
}
.head {
  text-align: center;
  display: grid;
  gap: 10px;
  margin-top: 16px;
}
.suits {
  letter-spacing: 0.45em;
  color: var(--gold);
  opacity: 0.4;
  font-size: 0.85rem;
}
.title {
  font-size: 2rem;
  font-weight: 900;
  letter-spacing: 0.16em;
  line-height: 1.2;
}
.pad {
  padding: 20px;
}
.label {
  font-weight: 800;
  font-size: 0.78rem;
  color: var(--muted);
  letter-spacing: 0.18em;
  text-transform: uppercase;
  margin-bottom: 10px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 9px;
}
.tbtn {
  flex-direction: column;
  gap: 3px;
  padding: 13px 10px;
  align-items: flex-start;
}
.tbtn.on {
  background: linear-gradient(180deg, var(--gold-hi), var(--gold) 55%, #c08f28);
  border-color: #6b4c12;
  color: #2a1b00;
  box-shadow: 0 3px 0 #6b4c12, 0 0 24px rgba(240, 192, 74, 0.4);
}
.tnum {
  font-size: 1.2rem;
  font-weight: 900;
  color: var(--gold-hi);
}
.tbtn.on .tnum {
  color: #2a1b00;
}
.tname {
  font-size: 0.8rem;
  opacity: 0.8;
}
.small {
  font-size: 0.8rem;
  line-height: 1.8;
}
</style>
