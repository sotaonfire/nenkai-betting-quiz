<script setup>
const props = defineProps({
  open: Boolean,
  title: { type: String, default: '確認' },
  message: { type: String, default: '' },
  confirmLabel: { type: String, default: 'OK' },
  cancelLabel: { type: String, default: 'キャンセル' },
  danger: Boolean,
})
const emit = defineEmits(['confirm', 'cancel'])
</script>

<template>
  <div v-if="props.open" class="modal-backdrop" @click.self="emit('cancel')">
    <div class="modal">
      <h3 style="margin: 0 0 10px">{{ props.title }}</h3>
      <p class="muted" style="white-space: pre-wrap; margin: 0 0 18px">{{ props.message }}</p>
      <slot />
      <div class="row" style="justify-content: flex-end; margin-top: 18px">
        <button class="btn btn-ghost" @click="emit('cancel')">{{ props.cancelLabel }}</button>
        <button
          class="btn"
          :class="props.danger ? 'btn-danger' : 'btn-primary'"
          @click="emit('confirm')"
        >
          {{ props.confirmLabel }}
        </button>
      </div>
    </div>
  </div>
</template>
