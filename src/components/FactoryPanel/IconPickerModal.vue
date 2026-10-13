<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { IconCategories, IconRef } from '../../lib/markup/itemIcons'
import { itemIconUrl } from '../../lib/markup/itemIcons'
import RecipeTip from './RecipeTip.vue'

/**
 * 图标选择浮层: 只负责「列出当前分类的图标、交出一个选中项」
 *
 * 列出哪些分类、每类里有哪些图标、选完怎么用，都是调用方的事；
 */
const props = defineProps<{
  open: boolean
  /** 分类名 → 图标 */
  categories: IconCategories
  /** 默认分类名；没给（或给的名字不在 categories 里）就用第一个分类 */
  defaultCategory?: string
  /** 当前这一位上的图标 id（0 = 空），用来高亮 */
  current?: number
  /** 标题 */
  title?: string
  /** 是否显示「固定」 */
  showPin?: boolean
  /** 贴着哪个元素显示（输入框 / 缩略图图标位 / 按钮） */
  anchor?: HTMLElement | null
}>()

const emit = defineEmits<{
  /** 选中一个图标 */
  (e: 'select', icon: IconRef): void
  (e: 'close'): void
}>()
const box = ref<HTMLElement | null>(null)
/** 浮层位置（fixed 定位，视口坐标）与宽度（按可用空间收窄） */
const pos = ref<Record<string, string>>({ left: '0px', top: '0px', width: '520px', visibility: 'hidden' })

/** 分类名清单 */
const categoryNames = computed(() => Object.keys(props.categories))
/** 当前分类 */
const category = ref(props.defaultCategory ?? '')
/** 真正生效的分类 */
const activeCategory = computed(() =>
  categoryNames.value.includes(category.value) ? category.value : (categoryNames.value[0] ?? ''))
/** 当前分类的图标 */
const items = computed(() => props.categories[activeCategory.value] ?? [])

// ── 悬浮提示 ──────────────────────────────────────────────
// 带 recipeId 的项交给 RecipeTip，这里只管「哪个格子被悬浮」。

/** 正在悬浮的项 / 格子元素 */
const hovered = ref<IconRef | null>(null)
const hoveredCell = ref<HTMLElement | null>(null)

function onHover(item: IconRef, e: MouseEvent) {
  hovered.value = item
  hoveredCell.value = e.currentTarget as HTMLElement
}

function onUnhover(item: IconRef) {
  if (hovered.value === item) clearTip()
}

/** 鼠标挪到格子间隙（网格本身）时收起 */
function onGridLeave(e: MouseEvent) {
  if (!(e.target as HTMLElement).closest('.icon-picker-item')) clearTip()
}

/** 格子被滚出列表后就收掉（提示在 body 上，不会自己跟） */
function onTipMove() {
  if (hoveredCell.value && !hoveredCell.value.isConnected) clearTip()
}

/** 关浮层 / 换分类 / 挪浮层时收起 */
function clearTip() {
  hovered.value = null
  hoveredCell.value = null
}

/** 分类换了就退回默认分类 */
watch(() => props.categories, () => { category.value = props.defaultCategory ?? '' })

watch(activeCategory, clearTip)
watch(() => props.open, (open) => { if (!open) clearTip() })

/** 钉住 = 选完不关 */
const pinned = ref(true)
/** 选完是否留着不关 */
const keepOpen = computed(() => props.showPin === true && pinned.value)

/** 贴着锚点摆位置: 水平优先弹在面板外侧，两边都塞不下就夹进视口；竖直跟着字段走，底边放不下就上移 */
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
  clearTip() // 浮层挪了，跟着格子摆的提示就不作数了
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
    window.addEventListener('resize', onTipMove)
    window.addEventListener('scroll', place, true)
    window.addEventListener('keydown', onKeydown)
  } else {
    window.removeEventListener('resize', place)
    window.removeEventListener('resize', onTipMove)
    window.removeEventListener('scroll', place, true)
    window.removeEventListener('keydown', onKeydown)
  }
}

// 每次打开量一次真实尺寸再定位（「固定」留着开关状态，不重置）
watch(() => props.open, async (open) => {
  bind(open)
  if (!open) return
  pos.value = { left: '0px', top: '0px', visibility: 'hidden' }
  await nextTick()
  place()
})

onBeforeUnmount(() => bind(false))

function pick(item: IconRef) {
  // 返回选择的项
  emit('select', item)
  // 默认选一个就关；钉住时留着继续插
  if (!keepOpen.value) emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="icon-popover-layer" @mousedown.self="requestClose" @mouseleave="clearTip">
      <!-- mousedown 会把焦点移到被点的元素上（点空白也一样），输入框就失焦了: 整块 prevent 掉 -->
      <div ref="box" class="icon-popover" :style="pos" @mousedown.prevent.stop>
        <div class="icon-popover-head">
          <div class="icon-popover-head-left">
            <span>{{ title || '选择图标' }}</span>
            <!-- 高亮 = 钉住 -->
            <button
              v-if="showPin === true"
              class="icon-pin"
              :class="{ active: pinned }"
              type="button"
              title="固定"
              @click="pinned = !pinned"
            >
              <svg viewBox="0 0 16 16" width="13" height="13">
                <path d="M5 3h6" />
                <path d="M8 3v6" />
                <path d="M5.5 9.5h5" />
                <path d="M8 9.5V14" />
              </svg>
            </button>
          </div>
          <button class="modal-close" type="button" @click="requestClose">✕</button>
        </div>

        <div class="icon-picker">
          <!-- 只有一个分类不显示分类按钮 -->
          <div v-if="categoryNames.length > 1" class="icon-picker-cats">
            <button
              v-for="name in categoryNames"
              :key="name"
              type="button"
              class="btn-sm icon-picker-cat"
              :class="{ active: activeCategory === name }"
              @click="category = name"
            >{{ name }}</button>
          </div>

          <!-- 格子被滚出列表时要收掉提示 -->
          <div
            v-if="items.length"
            class="icon-picker-grid"
            @scroll="onTipMove"
            @mouseover="onGridLeave"
            @mouseleave="clearTip"
          >
            <button
              v-for="item in items"
              :key="item.id"
              type="button"
              class="icon-picker-item"
              :class="{ active: current !== undefined && item.id === current }"
              :title="Number(item.recipeId) > 0 ? undefined : (item.markup ? `${item.name}（${item.markup}）` : item.name)"
              @mouseenter="onHover(item, $event)"
              @mouseleave="onUnhover(item)"
              @click="pick(item)"
            >
              <img class="factory-icon" :src="itemIconUrl(item.id)" :alt="item.name" />
            </button>
          </div>
          <div v-else class="icon-picker-empty">这里没有可选的图标</div>
        </div>
      </div>
    </div>

    <!-- 配方提示（换格子会重挂） -->
    <RecipeTip
      v-if="open"
      :key="hoveredCell ? hovered?.id : 'none'"
      :recipe-id="Number(hovered?.recipeId) || 0"
      :visible="hoveredCell !== null"
      :anchor="hoveredCell"
    />
  </Teleport>
</template>

<style scoped>
/* 只接「点外面关闭」，不压暗（游戏里也没有遮罩） */
.icon-popover-layer {
  position: fixed;
  inset: 0;
  z-index: 120;
}

.icon-popover {
  position: fixed;
  display: flex;
  flex-direction: column;
  width: min(520px, 92vw);
  max-height: min(70vh, 560px);
  background: var(--bg-panel);
  border: 1px solid var(--line);
  border-radius: 12px;
  box-shadow: 0 14px 40px rgba(0, 0, 0, 0.55);
  overflow: hidden;
}

.icon-popover-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 6px 6px 14px;
  border-bottom: 1px solid var(--line);
  font-size: 13px;
  font-weight: bold;
}

.icon-popover-head-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

/* 钉住（默认）时选完不关，可以连着插 */
.icon-pin {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border-radius: 5px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--fg-muted);
  cursor: pointer;
}

.icon-pin svg {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.4;
  stroke-linecap: round;
}

.icon-pin:hover {
  border-color: var(--line-strong);
  color: var(--fg-strong);
}

/* 图钉斜过来 + 高亮，同游戏里 pinBtn.highlighted */
.icon-pin.active {
  border-color: var(--accent);
  background: #22345c;
  color: var(--fg-value);
}

.icon-pin.active svg {
  transform: rotate(-35deg);
}

.icon-picker {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  padding: 10px 12px 12px;
  overflow-y: auto;
}

.icon-picker-cats {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.icon-picker-cat {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: var(--bg-slot);
  color: var(--fg-secondary);
  border: 1px solid var(--line-strong);
}

.icon-picker-cat.active {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

/* 格子里只有图标（名字在悬浮提示里），列可以窄一些 */
.icon-picker-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(46px, 1fr));
  gap: 6px;
  max-height: 42vh;
  overflow-y: auto;
  padding-right: 4px;
}

.icon-picker-item {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-width: 0;
  padding: 3px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--bg-inset);
  color: var(--fg-secondary);
  cursor: pointer;
}

.icon-picker-item:hover {
  border-color: #34506f;
  background: #16203a;
}

.icon-picker-item.active {
  border-color: var(--accent);
  box-shadow: inset 0 0 0 1px rgba(67, 100, 235, 0.5);
}

.icon-picker-item .factory-icon {
  width: 34px;
  height: 34px;
}

.icon-picker-empty {
  padding: 20px 0;
  text-align: center;
  font-size: 12px;
  color: var(--fg-muted);
}
</style>
