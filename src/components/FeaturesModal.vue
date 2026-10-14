<script setup lang="ts">
import { ref, watch } from 'vue'
import BaseModal from './BaseModal.vue'

interface FeatureGroup {
  name: string
  items: string[]
}

interface InlineToken {
  strong: boolean
  code: boolean
  text: string
}

const open = ref(false)
const groups = ref<FeatureGroup[]>([])
const failed = ref(false)
const loaded = ref(false)

function normalizeFeatures(raw: unknown): FeatureGroup[] {
  if (!Array.isArray(raw)) return []
  const out: FeatureGroup[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const row = entry as Record<string, unknown>
    const name = typeof row.name === 'string' ? row.name.trim() : ''
    const items = Array.isArray(row.items)
      ? row.items.filter((t): t is string => typeof t === 'string' && t.trim() !== '')
      : []
    if (name && items.length) out.push({ name, items })
  }
  return out
}

async function loadFeatures() {
  if (loaded.value || failed.value) return
  try {
    const url = new URL('./features.json', document.baseURI)
    const res = await fetch(url, { cache: 'no-cache' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    groups.value = normalizeFeatures((await res.json())?.groups)
    loaded.value = true
  } catch {
    failed.value = true
  }
}

watch(open, (isOpen) => {
  if (isOpen) loadFeatures()
})

function openModal() {
  open.value = true
}

function closeModal() {
  open.value = false
}

/**
 * 只认 **加粗** 和 `代码` 两种行内标记；
 * 剩下的原样当文本渲染，全走插值，不碰 v-html
 */
const MARKUP_RE = /(\*\*[^*]+\*\*|`[^`]+`)/

function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = []
  for (const part of text.split(MARKUP_RE)) {
    if (!part) continue
    if (part.startsWith('**') && part.endsWith('**')) {
      tokens.push({ strong: true, code: false, text: part.slice(2, -2) })
    } else if (part.startsWith('`') && part.endsWith('`')) {
      tokens.push({ strong: false, code: true, text: part.slice(1, -1) })
    } else {
      tokens.push({ strong: false, code: false, text: part })
    }
  }
  // 没配成对的 ` 和 ** 会原样留下，当普通文本渲染，不会把后面整段染色
  return tokens
}

defineExpose({ open: openModal })
</script>

<template>
  <BaseModal :open="open" title="功能介绍" @close="closeModal">
    <div v-for="(group, i) in groups" :key="i" class="feature-group">
      <h3>{{ group.name }}</h3>
      <ul>
        <li v-for="(item, j) in group.items" :key="j">
          <template v-for="(token, k) in parseInline(item)" :key="k">
            <code v-if="token.code">{{ token.text }}</code>
            <strong v-else-if="token.strong">{{ token.text }}</strong>
            <template v-else>{{ token.text }}</template>
          </template>
        </li>
      </ul>
    </div>
    <div v-if="failed" class="feature-group">功能介绍加载失败</div>
  </BaseModal>
</template>

<style scoped>
.feature-group {
  margin-bottom: 14px;
}

.feature-group:last-child {
  margin-bottom: 0;
}

.feature-group h3 {
  margin: 0 0 6px;
  font-size: 14px;
  color: var(--fg);
}

.feature-group ul {
  margin: 0;
  padding-left: 18px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--fg-secondary);
}

.feature-group li + li {
  margin-top: 4px;
}

.feature-group strong {
  color: var(--fg);
  font-weight: bold;
}

.feature-group code {
  padding: 0 4px;
  border-radius: 4px;
  background: var(--bg-slot);
  color: var(--fg-value);
}
</style>
