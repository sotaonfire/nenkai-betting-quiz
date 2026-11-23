<script setup>
import { computed, onUnmounted, ref } from 'vue'
import { toMillis } from '../lib/util.js'

const props = defineProps({
  startedAt: { type: Object, default: null },
  limitSec: { type: Number, default: 20 },
  size: { type: Number, default: 160 },
})

const now = ref(Date.now())
const timer = setInterval(() => (now.value = Date.now()), 200)
onUnmounted(() => clearInterval(timer))

const remaining = computed(() => {
  const start = toMillis(props.startedAt)
  if (!start) return props.limitSec
  const left = props.limitSec - (now.value - start) / 1000
  return Math.max(0, left)
})
const ratio = computed(() => (props.limitSec ? remaining.value / props.limitSec : 0))
const display = computed(() => Math.ceil(remaining.value))
// 数字は大きく、「受付中」は3文字が円に収まるサイズに落とす
const labelSize = computed(() =>
  Math.round(props.size * (display.value > 0 ? 0.34 : 0.19)),
)
const color = computed(() => {
  if (remaining.value <= 0) return 'var(--muted)'
  if (ratio.value < 0.3) return 'var(--red)'
  return 'var(--gold)'
})
const circumference = 2 * Math.PI * 46
</script>

<template>
  <div class="ring" :style="{ width: props.size + 'px', height: props.size + 'px' }">
    <svg viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="46" fill="none" stroke="var(--line)" stroke-width="7" />
      <circle
        cx="50"
        cy="50"
        r="46"
        fill="none"
        :stroke="color"
        stroke-width="7"
        stroke-linecap="round"
        :stroke-dasharray="circumference"
        :stroke-dashoffset="circumference * (1 - ratio)"
        transform="rotate(-90 50 50)"
        style="transition: stroke-dashoffset 0.2s linear"
      />
    </svg>
    <div class="ring-label tabular" :style="{ color, fontSize: labelSize + 'px' }">
      <template v-if="display > 0">{{ display }}</template>
      <template v-else>受付中</template>
    </div>
  </div>
</template>

<style scoped>
.ring {
  position: relative;
  display: grid;
  place-items: center;
}
.ring svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.ring-label {
  font-weight: 900;
  line-height: 1;
  white-space: nowrap;
  letter-spacing: 0;
  max-width: 78%;
  text-align: center;
}
</style>
