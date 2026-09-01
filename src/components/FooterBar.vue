<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'
import VisitorStats from './VisitorStats.vue'

const emit = defineEmits<{ (e: 'open-changelog'): void }>()

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
    <button type="button" class="footer-item" aria-haspopup="dialog" @click="emit('open-changelog')">
      更新日志
    </button>
    |
    <a href="https://github.com/HCKxv/dysonBlueprintParser" target="_blank" rel="noopener">
      <div class="footer-item">GitHub仓库</div>
    </a>
    |
    <a href="https://hckxv.github.io/DSB/" target="_blank" rel="noopener">
      <div class="footer-item">戴森球蓝图集</div>
    </a>
    
    <VisitorStats />
  </div>
</template>
