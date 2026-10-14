<script setup lang="ts">
import { ref } from 'vue'
import BaseModal from './BaseModal.vue'

/** 联系方式行 */
export interface ContactItem {
  type: 'text' | 'link'
  text?: string
  label?: string
  href?: string
}

const props = defineProps<{
  items: ContactItem[]
}>()

const open = ref(false)

function openModal() {
  open.value = true
}

function closeModal() {
  open.value = false
}

defineExpose({ open: openModal })
</script>

<template>
  <BaseModal :open="open" title="联系方式" @close="closeModal">
    <div class="contact-list">
      <div v-for="(item, i) in props.items" :key="i" class="contact-row">
        <template v-if="item.type === 'link'">
          <span class="contact-text">{{ item.text }}</span>
          <a :href="item.href" target="_blank" rel="noopener" class="contact-link">{{ item.label }}</a>
        </template>
        <span v-else class="contact-text">{{ item.text }}</span>
      </div>
    </div>
  </BaseModal>
</template>

<style scoped>
.contact-row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
  padding: 6px 0;
  font-size: 13px;
  line-height: 1.7;
  color: var(--fg-secondary);
}

/* 相邻两行之间来一条淡分割线 */
.contact-row + .contact-row {
  border-top: 1px solid var(--line-soft);
}

.contact-text {
  overflow-wrap: anywhere;
}

.contact-link {
  color: var(--warn);
  text-decoration: none;
  overflow-wrap: anywhere;
}

.contact-link:hover {
  text-decoration: underline;
}
</style>
