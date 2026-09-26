<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { ICON_CATEGORIES, filterIcons } from '../../lib/markup/iconCatalog'
import type { IconEntry, IconRef } from '../../lib/markup/iconCatalog'
import { itemIconUrl } from '../../lib/markup/itemIcons'

/**
 * 图标选择器: 贴在触发它的输入框（或缩略图图标位）旁边
 *
 * 只管"列出图标、交出一个选中项"：算不算清除、要不要继续插，都是调用方的事。
 */
const props = defineProps<{
  open: boolean
  /** 当前这一位上的图标 id（0 = 空） */
  current: number
  /** 是否显示「固定」（缩略图图标位用不上：那里一直是选完就关） */
  showPin?: boolean
  /** 贴着哪个元素显示（输入框 / 缩略图图标位） */
  anchor?: HTMLElement | null
}>()

const emit = defineEmits<{
  /** 选中一个图标: 交出去的是 `{ id, name, markup }`，markup 没有标记时是空串 */
  (e: 'select', icon: IconRef): void
  (e: 'close'): void
}>()
const box = ref<HTMLElement | null>(null)
/** 浮层位置（fixed 定位，视口坐标）与宽度（按可用空间收窄） */
const pos = ref<Record<string, string>>({ left: '0px', top: '0px', width: '520px', visibility: 'hidden' })

/** 只列真实分类（库里 ICON_CATEGORIES 那个「全部」选择器上用不到） */
const categories = ICON_CATEGORIES.filter((cat) => cat.id !== 'all')
/** 首次打开默认选中的分类 */
const DEFAULT_CATEGORY = 'item'
/** 当前分类: 和「固定」一样带记忆，下次打开还是上次那个 */
const category = ref(DEFAULT_CATEGORY)
/** 固定住: 选完不关，可以连着插好几个；默认就钉住 */
const pinned = ref(true)
/** 选完是否留着不关 */
const keepOpen = computed(() => props.showPin !== false && pinned.value)

/** 贴着锚点摆位置: 水平优先弹在面板外侧，两边都塞不下就按可用空间收窄；竖直跟着字段走，底边放不下就上移 */
async function place() {
  const anchor = props.anchor
  const node = box.value
  if (!anchor || !node) return

  const rect = anchor.getBoundingClientRect()
  const gap = 8
  const margin = 8
  const maxWidth = Math.min(520, window.innerWidth - margin * 2)
  const leftSpace = rect.left - gap - margin
  const rightSpace = window.innerWidth - rect.right - gap - margin

  let width = maxWidth
  let left: number
  if (leftSpace >= maxWidth) {
    left = rect.left - gap - width
  } else if (rightSpace >= maxWidth) {
    left = rect.right + gap
  } else if (leftSpace >= rightSpace && leftSpace >= 240) {
    width = leftSpace
    left = rect.left - gap - width
  } else if (rightSpace >= 240) {
    width = rightSpace
    left = rect.right + gap
  } else {
    // 两侧都太窄: 夹进视口，允许压住一点
    left = Math.max(margin, rect.left - width - gap)
    left = Math.min(left, window.innerWidth - width - margin)
  }

  // 宽度先落地（网格会重排），量到真实高度后再定 top
  node.style.width = `${Math.round(width)}px`
  pos.value = { left: `${Math.round(left)}px`, top: '0px', width: `${Math.round(width)}px`, visibility: 'hidden' }
  await nextTick()

  // 竖直方向: 跟着字段走，比字段顶边高一点（不至于压住字段本身）
  const height = node.offsetHeight
  let top = Math.max(margin, rect.top - 100)
  if (top + height > window.innerHeight - margin) {
    top = Math.max(margin, window.innerHeight - height - margin)
    // 上移之后别低到压住正在编辑的字段
    top = Math.min(top, rect.top)
  }
  pos.value = {
    left: `${Math.round(left)}px`,
    top: `${Math.round(top)}px`,
    width: `${Math.round(width)}px`,
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') requestClose()
}

/** 用户主动关掉（✕ / Esc / 点外面） */
function requestClose() {
  emit('close')
}

function bind(open: boolean) {
  if (open) {
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    window.addEventListener('keydown', onKeydown)
  } else {
    window.removeEventListener('resize', place)
    window.removeEventListener('scroll', place, true)
    window.removeEventListener('keydown', onKeydown)
  }
}

// 每次打开量一次真实尺寸再定位（「固定」和「分类」都不重置: 一个刻意留着开关状态，一个带记忆）
watch(() => props.open, async (open) => {
  bind(open)
  if (!open) return
  pos.value = { left: '0px', top: '0px', visibility: 'hidden' }
  await nextTick()
  place()
})

onBeforeUnmount(() => bind(false))

const list = computed(() => filterIcons(category.value))

function pick(entry: IconEntry) {
  // 三样身份一起交出去: id 给缩略图槽位，markup 给富文本字段直接插
  emit('select', { id: entry.id, name: entry.name, markup: entry.markup })
  // 默认选一个就关；钉住时留着继续插
  if (!keepOpen.value) emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="icon-popover-layer" @mousedown.self="requestClose">
      <!-- mousedown 会把焦点移到被点的元素上（点空白也一样），输入框就失焦了: 整块 prevent 掉 -->
      <div ref="box" class="icon-popover" :style="pos" @mousedown.prevent.stop>
        <div class="icon-popover-head">
          <div class="icon-popover-head-left">
            <span>选择图标</span>
            <!-- 高亮 = 钉住 -->
            <button
              v-if="showPin !== false"
              class="icon-pin"
              :class="{ active: pinned }"
              type="button"
              :aria-pressed="pinned"
              aria-label="固定"
              title="固定"
              @click="pinned = !pinned"
            >
              <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
                <path d="M5 3h6" />
                <path d="M8 3v6" />
                <path d="M5.5 9.5h5" />
                <path d="M8 9.5V14" />
              </svg>
            </button>
          </div>
          <button class="modal-close" type="button" aria-label="关闭" @click="requestClose">✕</button>
        </div>

        <div class="icon-picker">
          <div class="icon-picker-cats">
            <button
              v-for="cat in categories"
              :key="cat.id"
              type="button"
              class="btn-sm icon-picker-cat"
              :class="{ active: category === cat.id }"
              @click="category = cat.id"
            >{{ cat.label }}</button>
          </div>

          <div v-if="list.length" class="icon-picker-grid">
            <button
              v-for="entry in list"
              :key="entry.id"
              type="button"
              class="icon-picker-item"
              :class="{ active: entry.id === current }"
              :title="entry.markup ? `${entry.name}（${entry.markup}）` : entry.name"
              @click="pick(entry)"
            >
              <img class="factory-icon" :src="itemIconUrl(entry.id)" :alt="entry.name" />
            </button>
          </div>
          <div v-else class="icon-picker-empty">这个分类下没有图标</div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
