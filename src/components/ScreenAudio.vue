<script setup>
/**
 * スクリーン画面専用のBGM。ゲーム中ずっと同じ曲をループさせる。
 * このコンポーネントは ScreenView からのみ読み込むので、
 * 回答画面（スマホ）や司会画面では音は鳴らない。
 *
 * ブラウザの自動再生制限により、ページを開いただけでは音を出せない。
 * 最初に一度だけユーザー操作（クリック）が必要なので開始ボタンを出す。
 */
import { onMounted, onUnmounted, ref } from 'vue'

const SRC = '/audio/bgm.mp3'
const LS_KEY = 'bq.audio'

const audio = ref(null)
const started = ref(false)
const muted = ref(false)
const volume = ref(0.35)
const message = ref('')
const expanded = ref(false)

// 音量とミュートは端末に覚えさせる（開始操作だけは毎回必要）
try {
  const saved = JSON.parse(localStorage.getItem(LS_KEY) || '{}')
  if (typeof saved.volume === 'number') volume.value = saved.volume
  if (typeof saved.muted === 'boolean') muted.value = saved.muted
} catch {
  /* 読めなければ既定値のまま */
}

function persist() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ volume: volume.value, muted: muted.value }))
  } catch {
    /* 保存できなくても再生には影響しない */
  }
}

function applyVolume() {
  if (audio.value) audio.value.volume = muted.value ? 0 : volume.value
  persist()
}

async function start() {
  const el = audio.value
  if (!el) return
  el.volume = 0
  try {
    await el.play()
  } catch {
    message.value = '再生できませんでした。もう一度押してください'
    return
  }
  started.value = true
  message.value = ''
  // いきなり大音量にならないようフェードインする
  const target = muted.value ? 0 : volume.value
  const t0 = performance.now()
  const step = () => {
    const t = Math.min(1, (performance.now() - t0) / 1500)
    el.volume = target * t
    if (t < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

function toggleMute() {
  muted.value = !muted.value
  applyVolume()
}

function setVolume(v) {
  volume.value = Math.max(0, Math.min(1, Number(v)))
  if (volume.value > 0) muted.value = false
  applyVolume()
}

function nudge(d) {
  setVolume(Number((volume.value + d).toFixed(2)))
}

// スクリーンPCのキーボードから手早く調整する用
function onKey(e) {
  if (e.target instanceof HTMLInputElement) return
  if (e.key === 'm' || e.key === 'M') toggleMute()
  else if (e.key === 'ArrowUp') nudge(0.05)
  else if (e.key === 'ArrowDown') nudge(-0.05)
  else return
  e.preventDefault()
}

onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => {
  window.removeEventListener('keydown', onKey)
  audio.value?.pause()
})
</script>

<template>
  <audio
    ref="audio"
    :src="SRC"
    loop
    preload="auto"
    @error="message = 'BGMファイルを読み込めませんでした'"
  />

  <!-- 未開始：自動再生できないので一度押してもらう -->
  <button v-if="!started" class="start" @click="start">
    <span class="note">♪</span>
    <span>
      <span class="start-main">音楽を開始</span>
      <span class="start-sub">{{ message || 'ブラウザの制限で最初に1回だけ必要です' }}</span>
    </span>
  </button>

  <!-- 開始後：投影の邪魔にならないよう薄く置き、触ると開く -->
  <div
    v-else
    class="ctrl"
    :class="{ open: expanded }"
    @mouseenter="expanded = true"
    @mouseleave="expanded = false"
  >
    <button class="icon" :title="muted ? 'ミュート解除 (M)' : 'ミュート (M)'" @click="toggleMute">
      {{ muted ? '🔇' : '🔊' }}
    </button>
    <input
      class="slider"
      type="range"
      min="0"
      max="1"
      step="0.01"
      :value="volume"
      @input="setVolume($event.target.value)"
    />
    <span class="pct tabular">{{ Math.round((muted ? 0 : volume) * 100) }}</span>
  </div>
</template>

<style scoped>
/* ---- 開始ボタン ---- */
.start {
  position: fixed;
  right: 22px;
  bottom: 22px;
  z-index: 80;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 20px;
  border-radius: 999px;
  border: 1px solid var(--gold-lo);
  background: linear-gradient(180deg, rgba(240, 192, 74, 0.26), rgba(240, 192, 74, 0.08));
  color: var(--gold-hi);
  font-weight: 800;
  text-align: left;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
  animation: pulse 2.4s ease-in-out infinite;
}
@keyframes pulse {
  0%,
  100% {
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5), 0 0 0 0 rgba(240, 192, 74, 0.35);
  }
  50% {
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5), 0 0 0 10px rgba(240, 192, 74, 0);
  }
}
.note {
  font-size: 1.5rem;
  line-height: 1;
}
.start-main {
  display: block;
  font-size: 1.05rem;
}
.start-sub {
  display: block;
  font-size: 0.72rem;
  opacity: 0.75;
  font-weight: 600;
}

/* ---- 音量コントロール ---- */
.ctrl {
  position: fixed;
  right: 18px;
  bottom: 18px;
  z-index: 80;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 999px;
  border: 1px solid #45202e;
  background: rgba(20, 8, 13, 0.7);
  opacity: 0.28;
  transition: opacity 0.2s ease;
}
.ctrl.open {
  opacity: 1;
}
.icon {
  background: none;
  border: none;
  font-size: 1.1rem;
  line-height: 1;
  padding: 0 2px;
}
.slider {
  width: 0;
  padding: 0;
  border: none;
  background: none;
  opacity: 0;
  transition: width 0.2s ease, opacity 0.2s ease;
  accent-color: var(--gold);
}
.ctrl.open .slider {
  width: 110px;
  opacity: 1;
}
.pct {
  width: 0;
  overflow: hidden;
  font-size: 0.78rem;
  font-weight: 800;
  color: var(--gold-hi);
  transition: width 0.2s ease;
}
.ctrl.open .pct {
  width: 2.2em;
}
</style>
