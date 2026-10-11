<script lang="ts">
/**
 * 蓝图缩略图: 底图 + 按布局摆的图标位 + 底部文字
 *
 * 布局按 100×100 的正方形算: 每个图标给出相对中心的偏移 (x, y) 和边长，y 轴向上。
 */

/** 一个图标槽位: [相对中心的 x, 相对中心的 y, 边长]（图标区基准 100×100，y 向上） */
type IconSlot = [number, number, number]

/** 布局编号 → 5 个图标槽位（null = 该布局没有这个位置） */
const ICON_LAYOUTS: Record<number, Array<IconSlot | null>> = {
  10: [[-1, 9, 80], null, null, null, null],                                  // OneIcon
  11: [[-1, 9, 40], null, null, null, null],                                  // OneIconSmall
  20: [[-19, 9, 40], [18, 9, 40], null, null, null],                          // TwoIcon46
  21: [[-3, 9, 80], [20, -12, 40], null, null, null],                         // TwoIcon53
  22: [[-3, 9, 80], [20, 31, 40], null, null, null],                          // TwoIcon59
  23: [[2, 9, 80], [-21, 31, 40], null, null, null],                          // TwoIcon57
  24: [[2, 9, 80], [-21, -12, 40], null, null, null],                         // TwoIcon51
  30: [[0, 26, 40], [-19, -9, 40], [19, -9, 40], null, null],                 // ThreeIcon813
  31: [[0, -9, 40], [-19, 26, 40], [19, 26, 40], null, null],                 // ThreeIcon279
  32: [[-1, 9, 80], [-21, 31, 40], [20, -12, 40], null, null],                // ThreeIcon573
  33: [[-1, 9, 80], [20, 31, 40], [-21, -12, 40], null, null],                // ThreeIcon591
  40: [[-19, 26, 40], [18, 26, 40], [-19, -11, 40], [18, -11, 40], null],     // FourIcon7913
  41: [[-23, 8, 40], [23, 8, 40], [0, 30, 40], [0, -14, 40], null],           // FourIcon8462
  50: [[-19, 26, 40], [18, 26, 40], [-19, -12, 40], [18, -12, 40], [0, 7, 40]], // FiveIcon57913
  51: [[-15, -14, 40], [14, -14, 40], [-25, 13, 40], [24, 13, 40], [-1, 32, 40]], // FiveIconPenta
}

/** 0 / 1 = 不显示图标（5 个位置全部置空） */
const NO_ICON_LAYOUTS = new Set([0, 1])

/** 下拉框「无」用的值 */
export const NO_LAYOUT = 1

/** 五个位置全部置空 */
const NO_SLOTS: Array<IconSlot | null> = [null, null, null, null, null]

/** 取某个图标布局的槽位（layout 来自蓝图头部）: 表里没有的编号按「不显示」处理 */
function iconLayoutSlots(layout: unknown): Array<IconSlot | null> {
  const v = Number(layout)
  if (NO_ICON_LAYOUTS.has(v)) return NO_SLOTS
  return ICON_LAYOUTS[v] ?? NO_SLOTS
}

/**
 * 图标布局的文字，按「图标数-变体号」编号
 * （10 = 1-1、21 = 2-2、32 = 3-3、51 = 5-2）；0 / 1 是「无」，没有编号
 */
function formatIconLayout(layout: unknown): string {
  const v = Number(layout)
  if (!Number.isInteger(v)) return ''
  if (NO_ICON_LAYOUTS.has(v)) return '无'
  if (v < 10) return String(v)
  return `${Math.floor(v / 10)}-${(v % 10) + 1}`
}

/** 可选的图标布局（界面下拉框用）: 「无」+ 15 种排布，按编号升序 */
export const LAYOUT_OPTIONS = [
  { value: NO_LAYOUT, label: formatIconLayout(NO_LAYOUT) },
  ...Object.keys(ICON_LAYOUTS)
    .map(Number)
    .sort((a, b) => a - b)
    .map((value) => ({ value, label: formatIconLayout(value) })),
]

/** 一个槽位: 布局给的位置/边长 + 图标 id 查出来的名字与图标 */
interface ThumbSlot {
  /** 布局表里的位置与边长 */
  slot: IconSlot
  /** 图标 id（0 = 空位） */
  itemId: number
  /** 显示名（只用于 img 的 alt） */
  name: string
  /** 图标 URL（空 = 没有图标，退化成 #id 或 ＋） */
  icon: string
}

/** 槽位换算成 CSS 百分比（图标区是 100×100 的正方形，1 单位正好 1%） */
function slotStyle(slot: IconSlot) {
  const [x, y, size] = slot
  return {
    left: `${50 + x - size / 2}%`,
    top: `${50 - y - size / 2}%`,
    width: `${size}%`,
    height: `${size}%`,
  }
}
</script>

<script setup lang="ts">
import { computed } from 'vue'
import { itemName } from '../../lib/blueprint/factory/factoryItems.js'
import { itemIconUrl } from '../../lib/markup/itemIcons'
import RichText from './RichText.vue'
import blueprintTileUrl from '../../assets/factory/blueprint-tile.png'

/**
 * 缩略图（坐标纸底图 + 按布局摆的图标 + 底部文字）
 *
 * 点击槽位后的处理（弹选择器）由父组件做
 * （选择器是浮层，状态在那边）。
 */
const props = defineProps<{
  /** 蓝图头部里的图标布局 */
  layout: number
  /** 蓝图头部里的 5 个图标位（0 = 空位） */
  icons: number[]
  /** 缩略图文字（空的话整条不显示） */
  shortDesc?: string
}>()

const emit = defineEmits<{
  (e: 'pick-slot', index: number, itemId: number, event: MouseEvent): void
  (e: 'clear-slot', index: number): void
}>()

/** 布局给位置/边长，图标位给每个位置上的内容 */
const slots = computed<(ThumbSlot | null)[]>(() => iconLayoutSlots(props.layout).map((slot, i) => {
  if (!slot) return null
  const itemId = Number(props.icons?.[i]) || 0
  const name = itemId ? itemName(itemId) : ''
  return {
    slot,
    itemId,
    name,
    icon: itemId ? itemIconUrl(itemId) : '',
  }
}))
</script>

<template>
  <div class="factory-thumb" :style="{ backgroundImage: `url(${blueprintTileUrl})` }">
    <div class="factory-thumb-area">
      <template v-for="(cell, i) in slots" :key="i">
        <button
          v-if="cell"
          type="button"
          class="factory-thumb-slot"
          :class="{ empty: !cell.itemId }"
          :style="slotStyle(cell.slot)"
          :title="cell.itemId ? '右键删除图标' : undefined"
          @click="emit('pick-slot', i, cell.itemId, $event)"
          @contextmenu.prevent="emit('clear-slot', i)"
        >
          <img
            v-if="cell.icon"
            class="factory-thumb-icon"
            :src="cell.icon"
            :alt="cell.name"
          />
          <span v-else-if="cell.itemId" class="factory-thumb-fallback">{{ `#${cell.itemId}` }}</span>
          <span v-else class="factory-thumb-plus">＋</span>
        </button>
      </template>
    </div>
    <!-- 缩略图文字为空时不显示任何东西（包括「新蓝图」占位） -->
    <div v-if="shortDesc" class="factory-thumb-caption" :title="shortDesc">
      <RichText :text="shortDesc" />
    </div>
  </div>
</template>

<style scoped>
/* 保持底图比例（10:11），上下自动边距 → 多余空间平分到上下、垂直居中 */
.factory-thumb {
  position: relative;
  aspect-ratio: 10 / 11;
  margin-block: auto;
  container-type: inline-size;   /* 文字用 cqw 跟着宽度缩放 */
  border-radius: 6px;
  background-repeat: no-repeat;
  background-position: center;
  background-size: 100% 100%;
}

/* 图标区: 底图顶部那块正方形（占卡片高的 10/11） */
.factory-thumb-area {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  aspect-ratio: 1 / 1;
}

.factory-thumb-slot {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  overflow: hidden;
}

.factory-thumb-slot:hover,
.factory-thumb-slot:focus-visible {
  border-color: rgba(120, 200, 255, 0.9);
  background: rgba(9, 20, 40, 0.35);
  outline: none;
}

/* 空位: 虚线框 + 加号 */
.factory-thumb-slot.empty {
  border-style: dashed;
  border-color: rgba(150, 210, 255, 0.45);
}

.factory-thumb-slot.empty:hover {
  border-style: solid;
  border-color: rgba(120, 200, 255, 0.9);
}

.factory-thumb-plus {
  font-size: 14px;
  line-height: 1;
  color: rgba(200, 230, 255, 0.65);
  pointer-events: none;
}

.factory-thumb-slot .factory-thumb-icon,
.factory-thumb-slot .factory-thumb-fallback {
  position: static;
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #eaf3ff;
  font-size: 10px;
  font-weight: bold;
  text-shadow: 0 1px 3px rgba(0, 20, 60, 0.9);
  pointer-events: none;
  user-select: none;
  overflow: hidden;
}

/* 压在图纸偏下（对齐游戏里蓝图卡片）: 量过游戏截图（卡片 194×213），
   字号跟缩略图宽度走，所以用 cqw */
.factory-thumb-caption {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 5%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 4.5cqw;
  box-sizing: border-box;
  font-size: 13.6cqw;
  line-height: 1;
  font-weight: bold;
  color: #f2f7ff;
  text-shadow: 0 1px 3px rgba(0, 20, 60, 0.9), 0 0 5px rgba(0, 20, 60, 0.55);
  overflow: hidden;
}

/* 内嵌图标比字略大（同游戏比例） */
.factory-thumb-caption :deep(.rich-icon) {
  width: 1.06em;
  height: 1.06em;
  vertical-align: -0.22em;
}

/* 只读富文本: 居中、按缩略图宽度换行，最多两行
   （line-height 是 1，一行正好 1em，所以 2em 裁在行边界上） */
.factory-thumb-caption :deep(.rich-text-view) {
  text-align: center;
  white-space: pre-wrap;
  min-width: 0;                 /* flex 子项默认不肯缩到内容以下 */
  overflow-wrap: anywhere;      /* 没有空格的整串也能断行 */
  max-height: 2em;
  overflow: hidden;
}
</style>
