<script setup lang="ts">
defineProps<{
  open: boolean
  title: string
}>()

const emit = defineEmits<{
  close: []
}>()
</script>

<template>
  <div class="modal" :class="{ hidden: !open }">
    <div class="modal-backdrop" @click="emit('close')"></div>
    <div class="modal-box">
      <div class="modal-header">
        <span>{{ title }}</span>
        <button class="modal-close" aria-label="关闭" @click="emit('close')">✕</button>
      </div>
      <div class="modal-body scroll-y">
        <slot />
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal.hidden {
  display: none;
}

.modal-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
}

.modal-box {
  position: relative;
  width: min(480px, 92vw);
  max-height: 80vh;
  background: #0f1628;
  border: 1px solid #243556;
  border-radius: 14px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid #243556;
  font-weight: bold;
}

.modal-close {
  background: none;
  border: none;
  color: #bcc8e0;
  font-size: 16px;
  cursor: pointer;
  padding: 2px 8px;
  border-radius: 6px;
}

.modal-close:hover {
  background: #1a2a44;
  color: #fff;
}

.modal-body {
  padding: 12px 16px;
  overflow-y: auto;
}
</style>
