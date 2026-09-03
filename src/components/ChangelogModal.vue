<script setup lang="ts">
import { ref } from 'vue'
import pkg from '../../package.json'

const fullVersion = `V${pkg.version}`

interface ChangelogEntry {
  version: string
  changes: string[]
}

const open = ref(false)
const entries = ref<ChangelogEntry[]>([])
const failed = ref(false)
const loaded = ref(false)

async function loadChangelog() {
  if (loaded.value || failed.value) return
  try {
    const url = new URL('./changelog.json', document.baseURI)
    const res = await fetch(url, { cache: 'no-cache' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    entries.value = await res.json()
    loaded.value = true
  } catch {
    failed.value = true
  }
}

function openModal() {
  open.value = true
  loadChangelog()
}

function closeModal() {
  open.value = false
}

defineExpose({ open: openModal })
</script>

<template>
  <div class="modal" :class="{ hidden: !open }">
    <div class="modal-backdrop" @click="closeModal"></div>
    <div class="modal-box">
      <div class="modal-header">
        <span>更新日志 {{ fullVersion }}</span>
        <button class="modal-close" aria-label="关闭" @click="closeModal">✕</button>
      </div>
      <div class="modal-body scroll-y">
        <div v-for="(entry, i) in entries" :key="i" class="changelog-entry">
          <h3>{{ entry.version }}</h3>
          <ul>
            <li v-for="(line, j) in entry.changes" :key="j">{{ line }}</li>
          </ul>
        </div>
        <div v-if="failed" class="changelog-entry">更新日志加载失败</div>
      </div>
    </div>
  </div>
</template>
