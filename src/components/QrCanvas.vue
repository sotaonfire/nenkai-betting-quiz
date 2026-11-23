<script setup>
import { onMounted, ref, watch } from 'vue'
import QRCode from 'qrcode'

const props = defineProps({
  text: { type: String, required: true },
  size: { type: Number, default: 240 },
  light: { type: Boolean, default: false },
})

const canvas = ref(null)

async function render() {
  if (!canvas.value || !props.text) return
  await QRCode.toCanvas(canvas.value, props.text, {
    width: props.size,
    margin: 1,
    color: props.light
      ? { dark: '#000000ff', light: '#ffffffff' }
      : { dark: '#0b0f1aff', light: '#ffffffff' },
    errorCorrectionLevel: 'M',
  })
}

onMounted(render)
watch(() => [props.text, props.size], render)
</script>

<template>
  <canvas ref="canvas" class="qr" :style="{ width: props.size + 'px', height: props.size + 'px' }" />
</template>

<style scoped>
.qr {
  background: #fff;
  border-radius: 10px;
  padding: 6px;
  display: block;
}
</style>
