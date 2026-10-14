<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, defineAsyncComponent } from 'vue'
import ChangelogModal from './ChangelogModal.vue'
import ContactModal from './ContactModal.vue'

const changelogModal = ref<InstanceType<typeof ChangelogModal> | null>(null)
const contactModal = ref<InstanceType<typeof ContactModal> | null>(null)

const VisitorStats = defineAsyncComponent(() =>
  import('./VisitorStats.vue')
)

interface FooterLink {
  label: string
  href: string
}

interface ContactItem {
  type: 'text' | 'link'
  text?: string
  label?: string
  href?: string
}

const links = ref<FooterLink[]>([])
const contact = ref<ContactItem[]>([])

function normalizeContact(raw: unknown): ContactItem[] {
  if (!Array.isArray(raw)) return []
  const items: ContactItem[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const row = entry as Record<string, unknown>
    const text = typeof row.text === 'string' ? row.text.trim() : ''
    const label = typeof row.label === 'string' ? row.label.trim() : ''
    const href = typeof row.href === 'string' ? row.href.trim() : ''
    if (row.type === 'link') {
      if (!href || (!label && !text)) continue
      items.push({ type: 'link', href, ...(label ? { label } : {}), ...(text ? { text } : {}) })
    } else if (row.type === 'text') {
      if (!text) continue
      items.push({ type: 'text', text })
    }
  }
  return items
}

const visitorStatsAllowed = import.meta.env.PROD
const showVisitorStats = ref(false)

// 页脚配置从 footer-links.json 加载
async function loadLinks() {
  try {
    const url = new URL('./footer-links.json', document.baseURI)
    const res = await fetch(url, { cache: 'no-cache' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    links.value = Array.isArray(data?.links) ? data.links : []
    contact.value = normalizeContact(data?.contact)
    if (visitorStatsAllowed && typeof data?.showVisitorStats === 'boolean') {
      showVisitorStats.value = data.showVisitorStats
    }
  } catch {
    links.value = []
    contact.value = []
  }
}

const rootEl = ref<HTMLElement | null>(null)
let timer: number | undefined

function clearTimer() {
  if (timer !== undefined) {
    window.clearTimeout(timer)
    timer = undefined
  }
}

// 页脚当前是否（至少部分）可见
function footerVisible(): boolean {
  const el = rootEl.value
  if (!el) return false
  const rect = el.getBoundingClientRect()
  return rect.top < window.innerHeight && rect.bottom > 0
}

function onScroll() {
  if (!footerVisible() || window.scrollY <= 0) {
    clearTimer()
    return
  }
  clearTimer()
  timer = window.setTimeout(() => {
    const el = rootEl.value
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.top >= window.innerHeight) return // 页脚已不在视野内
    const dist = window.innerHeight - rect.top + 2 // 多滚 2px 防止边界抖动
    window.scrollTo({ top: Math.max(0, window.scrollY - dist), behavior: 'smooth' })
  }, 5000)
}

onMounted(() => {
  loadLinks()
  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('resize', onScroll, { passive: true })
  onScroll()
})

onBeforeUnmount(() => {
  clearTimer()
  window.removeEventListener('scroll', onScroll)
  window.removeEventListener('resize', onScroll)
})
</script>

<template>
  <div ref="rootEl" class="footer-bar">
    <a href="#"><div class="footer-item">▲</div></a>
    |
    <button type="button" class="footer-item" @click="changelogModal?.open()">
      更新日志
    </button>
    <template v-for="link in links" :key="link.href">
      |
      <a :href="link.href" target="_blank" rel="noopener">
        <div class="footer-item">{{ link.label }}</div>
      </a>
    </template>

    <template v-if="contact.length">
      |
      <button type="button" class="footer-item" @click="contactModal?.open()">
        联系方式
      </button>
    </template>

    <VisitorStats v-if="showVisitorStats" />
  </div>
  <ChangelogModal ref="changelogModal" />
  <ContactModal ref="contactModal" :items="contact" />
</template>

<style scoped>
.footer-bar {
  padding: 14px 20px;
  /* 比面板底色再深一档，与滑块槽那个 #0b1220 不是同一个色，别并成一个变量 */
  background: #0b1020;
  border-top: 2px solid transparent;
  border-image: linear-gradient(90deg, #243556 0%, #4364eb 25%, #ffd866 50%, #4364eb 75%, #243556 100%) 1;
  color: var(--fg-secondary);
  font-size: 13px;
  display: flex;
  gap: 10px;
  justify-content: center;
  margin: 2px;
}

.footer-bar a {
  color: var(--fg-secondary);
  text-decoration: none;
}

.footer-bar a:hover .footer-item {
  background: #1a2a44;
  color: var(--fg);
}

.footer-bar button.footer-item {
  background: transparent;
  color: var(--fg-secondary);
  font: inherit;
  cursor: pointer;
}

.footer-bar button.footer-item:hover {
  background: #1a2a44;
  color: var(--fg);
}

.footer-item {
  padding: 1px 4px;
  border-radius: 6px;
  border: 1px solid var(--line-soft);
}

.footer-center {
  display: flex;
  align-items: center;
}
</style>
