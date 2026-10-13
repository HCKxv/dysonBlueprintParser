<script setup lang="ts">
/**
 * 物流配送器（2107）的参数
 */
import { computed, ref } from 'vue'
import { itemIconUrl } from '../../lib/markup/itemIcons'
import type { IconCategories, IconRef } from '../../lib/markup/itemIcons'
import { itemName } from '../../lib/blueprint/factory/factoryItems.js'
import IconPickerModal from './IconPickerModal.vue'

// 挡位表: 0 由勾选项表示，所以这里只列 0 以外的挡位
const PLAYER_MODES = [1, 2, 3]; // 回收 / 供应和回收 / 供应
const STORAGE_MODES = [1, 2];   // 供应 / 需求

// 挡位名（下标 = 模式的参数值）
const PLAYER_MODE_NAMES = {
  0: '向伊卡洛斯配送',
  1: '从伊卡洛斯回收',
  2: '向伊卡洛斯供应和回收',
  3: '向伊卡洛斯供应',
};
const STORAGE_MODE_NAMES = {
  0: '向其他配送器配送',
  1: '向其他配送器供应',
  2: '向其他配送器需求',
};

const SUPPLY_COLOR = '#5fd3f2';   // 供应侧 青
const DEMAND_COLOR = '#ef9a5a';   // 回收·需求侧 橙

// 钮的落点: 0 左 / 1 中 / 2 右
const PLAYER_STOPS = [0, 1, 2];
const STORAGE_STOPS = [2, 0];

// 最大充能功率的区间与步长（MW）
const POWER_MIN = 0.9;
const POWER_MAX = 9;
const POWER_STEP = 0.3;

const props = defineProps<{
  /** 配送物品 id（建筑的 filterId，0 = 没选） */
  filterId: number
  /** 这栋建筑的参数对象 */
  parameters: Record<string, any>
  /** 物品图标（「物品」+「建筑」两类） */
  itemIcons: IconCategories
}>()

const emit = defineEmits<{
  /** 改了配送物品（建筑的 filterId） */
  'update:filter-id': [number]
  /** 改了一项参数（playerMode / storageMode / workEnergyPerTick / courierAutoReplenish） */
  change: [key: string, value: unknown]
}>()

// ── 配送物品 ──────────────────────────────────────────────────
const picker = ref(false)
const anchor = ref<HTMLElement | null>(null)

function openPicker(e: MouseEvent) {
  anchor.value = e.currentTarget as HTMLElement
  picker.value = true
}

function onPick(icon: IconRef) {
  emit('update:filter-id', Number(icon.id))
}

/** 右键图标 = 清除配送物品 */
const onClear = () => emit('update:filter-id', 0)

// ── 供需模式──────────────────────────
/** 命中哪一挡就是哪一挡；没命中的（含缺省）当作没勾选，不硬改数据 */
function readMode(raw: unknown, modes: number[]) {
  const mode = Number(raw ?? 0)
  return modes.includes(mode) ? mode : 0
}

/** 按一下挪到下一挡（到最右一挡后再按回到最左，循环） */
function nextMode(raw: unknown, modes: number[]) {
  const at = modes.indexOf(readMode(raw, modes))
  return modes[(at + 1) % modes.length]
}

const playerMode = computed(() => readMode(props.parameters?.playerMode, PLAYER_MODES))
const playerName = computed(() => PLAYER_MODE_NAMES[playerMode.value])
/** 钮的落点；底色类名里的那个数字就是模式值 */
const playerStop = computed(() => PLAYER_STOPS[PLAYER_MODES.indexOf(playerMode.value)])
const playerClass = computed(() => `factory-dispenser-player-${playerMode.value}`)
/** filterId 为负 = 勾了「回收所有类型」 */
const recycleAll = computed(() => Number(props.filterId ?? 0) < 0)
const itemDisabled = computed(() => playerMode.value === 1 && recycleAll.value)

/** 把负号翻回正值；-1 回到 0 */
function positiveFilterId(raw: number) {
  return raw === -1 ? 0 : -raw
}

/** 切「机甲供需」挡位；目标挡位不是回收时收掉 filterId 的负号 */
function setPlayerMode(next: number) {
  emit('change', 'playerMode', next)
  if (next === 1) return
  const raw = Number(props.filterId ?? 0)
  if (raw < 0) emit('update:filter-id', positiveFilterId(raw))
}

/** 勾上/取消「回收所有类型」；勾上时把「配送器间模式」归 0 */
function onRecycleAll(checked: boolean) {
  const raw = Number(props.filterId ?? 0)
  if (checked) {
    emit('update:filter-id', raw > 0 ? -raw : -1)
    emit('change', 'storageMode', 0)
  } else if (raw < 0) {
    emit('update:filter-id', positiveFilterId(raw))
  }
}

const storageMode = computed(() => readMode(props.parameters?.storageMode, STORAGE_MODES))
const storageName = computed(() => STORAGE_MODE_NAMES[storageMode.value])
const storageStop = computed(() => STORAGE_STOPS[STORAGE_MODES.indexOf(storageMode.value)])
const storageClass = computed(() => `factory-dispenser-storage-${storageMode.value}`)

/** 拖动中先只动本地值，松手才吸附并写回 */
const dragging = ref<number | undefined>(undefined)

/** 吸附到步长并钳在区间内（超范围的就停在两端）；NaN 退回下限 */
function snap(value: number) {
  const from = Number.isFinite(value) ? value : POWER_MIN
  const steps = Math.round((from - POWER_MIN) / POWER_STEP)
  const clamped = Math.min(POWER_MAX, Math.max(POWER_MIN, POWER_MIN + steps * POWER_STEP))
  return Math.round(clamped * 10) / 10   // 只留一位小数，消掉浮点尾巴
}

/** 滑块 / 数值当前的位置: 拖动中用本地值，否则用参数值吸附后的结果 */
const powerAt = computed(() => (dragging.value ?? snap(Number(props.parameters?.workEnergyPerTick))))

const powerFill = computed(() =>
  `${((powerAt.value - POWER_MIN) / (POWER_MAX - POWER_MIN)) * 100}%`)

/** 数值那一格；拖动中跟着滑块走 */
const powerText = computed(() => `${powerAt.value.toFixed(1)} MW`)

function onPowerInput(e: Event) {
  dragging.value = snap(Number((e.target as HTMLInputElement).value))
}

/** 松手: 吸附后写回参数 */
function onPowerCommit(e: Event) {
  const el = e.target as HTMLInputElement
  const value = snap(Number(el.value))
  dragging.value = value
  el.value = String(value)
  emit('change', 'workEnergyPerTick', value)
}

// 注入成 CSS 变量（两个色的值只写一份，CSS 里只引用变量名）
const COLORS: Record<string, string> = {
  '--dispenser-supply': SUPPLY_COLOR,
  '--dispenser-demand': DEMAND_COLOR,
}
</script>

<template>
  <div class="factory-selection-params" :style="COLORS">
    <div class="factory-selection-row factory-selection-param">
      <button
        class="factory-dispenser-item"
        :class="{ 'factory-dispenser-item-off': itemDisabled }"
        type="button"
        :disabled="itemDisabled"
        :title="itemDisabled ? '' : (filterId > 0 ? '右键清除' : '选择物品')"
        @click="openPicker"
        @contextmenu.prevent="onClear"
      >
        <img v-if="filterId > 0" class="factory-icon" :src="itemIconUrl(filterId)" :alt="itemName(filterId)" />
        <span v-else-if="!itemDisabled" class="factory-dispenser-empty">+</span>
      </button>
      <span v-if="filterId > 0 && !itemDisabled" class="factory-selection-value">{{ itemName(filterId) }}</span>
    </div>

    <div class="factory-selection-row factory-selection-param">
      <label class="factory-dispenser-check">
        <input
          type="checkbox"
          :checked="playerMode > 0"
          @change="setPlayerMode(playerMode > 0 ? 0 : 2)"
        />
      </label>
      <span class="factory-dispenser-mode-name">{{ playerName }}</span>
      <button
        v-if="playerMode > 0"
        class="factory-dispenser-switch"
        :class="playerClass"
        type="button"
        :data-stop="playerStop"
        @click="setPlayerMode(nextMode(playerMode, PLAYER_MODES))"
      >
        <span class="factory-dispenser-knob"></span>
      </button>
    </div>

    <div v-if="playerMode === 1" class="factory-selection-row factory-selection-param factory-dispenser-sub">
      <svg class="factory-dispenser-bend" viewBox="0 0 12 12" aria-hidden="true">
        <path d="M2.4 1.4v5.3h6.3" />
        <path d="M6.6 4.5l2.4 2.3-2.4 2.3" />
      </svg>
      <label class="factory-dispenser-check">
        <input
          type="checkbox"
          :checked="recycleAll"
          @change="onRecycleAll(($event.target as HTMLInputElement).checked)"
        />
      </label>
      <span>回收所有类型</span>
    </div>

    <div class="factory-selection-row factory-selection-param">
      <label class="factory-dispenser-check">
        <input
          type="checkbox"
          :checked="storageMode > 0"
          @change="emit('change', 'storageMode', ($event.target as HTMLInputElement).checked ? 1 : 0)"
        />
      </label>
      <span class="factory-dispenser-mode-name">{{ storageName }}</span>
      <button
        v-if="storageMode > 0"
        class="factory-dispenser-switch"
        :class="storageClass"
        type="button"
        :data-stop="storageStop"
        @click="emit('change', 'storageMode', nextMode(storageMode, STORAGE_MODES))"
      >
        <span class="factory-dispenser-knob"></span>
      </button>
    </div>

    <div class="factory-selection-row factory-selection-param">
      <label class="factory-dispenser-check">
        <input
          type="checkbox"
          :checked="!!parameters?.courierAutoReplenish"
          @change="emit('change', 'courierAutoReplenish', ($event.target as HTMLInputElement).checked)"
        />
      </label>
      <span>自动补充配送机</span>
    </div>

    <div class="factory-dispenser-power">
      <span class="factory-selection-label">最大充能功率</span>
      <input
        class="factory-dispenser-range"
        type="range"
        :min="POWER_MIN"
        :max="POWER_MAX"
        :step="POWER_STEP"
        :value="powerAt"
        :style="{ '--factory-range-fill': powerFill }"
        @input="onPowerInput"
        @change="onPowerCommit"
      />
      <span class="factory-dispenser-power-value">{{ powerText }}</span>
    </div>

    <IconPickerModal
      :open="picker"
      :categories="itemIcons"
      :current="filterId"
      :anchor="anchor"
      title="配送物品"
      @select="onPick"
      @close="picker = false"
    />
  </div>
</template>

<style scoped>
.factory-dispenser-item {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 32px;
  height: 32px;
  padding: 0;
  border-radius: 4px;
  border: 1px solid var(--line-strong);
  background: var(--bg-slot);
  color: #6f8ec0;
  cursor: pointer;
}

.factory-dispenser-item:hover {
  border-color: var(--accent);
}

/* 回收所有类型时不用选物品（按钮本身也带 disabled） */
.factory-dispenser-item-off,
.factory-dispenser-item-off:hover {
  border-color: var(--line-strong);
  opacity: 0.45;
  cursor: default;
}

.factory-dispenser-item .factory-icon {
  width: 80%;
  height: 80%;
}

.factory-dispenser-empty {
  font-size: 16px;
  line-height: 1;
}

.factory-dispenser-switch {
  position: relative;
  flex: 0 0 auto;
  width: 38px;
  height: 15px;
  padding: 0;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  --dispenser-knob-w: 15px;
}

/* 底色类名 = 行 + 模式值；两行有重号的值，不能只按值命名 */
.factory-dispenser-player-1 {
  background: var(--dispenser-demand);
}

.factory-dispenser-player-2 {
  background: linear-gradient(90deg, var(--dispenser-supply) 50%, var(--dispenser-demand) 50%);
}

.factory-dispenser-player-3 {
  background: var(--dispenser-supply);
}

.factory-dispenser-storage-1 {
  background: var(--dispenser-supply);
}

.factory-dispenser-storage-2 {
  background: var(--dispenser-demand);
}

/* left 是钮心位置，靠 translateX(-50%) 对上去 */
.factory-dispenser-knob {
  position: absolute;
  top: 0;
  left: calc(var(--dispenser-knob-w) / 2);
  width: var(--dispenser-knob-w);
  height: var(--dispenser-knob-w);
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
  transform: translateX(-50%);
  transition: left 0.15s ease;
}

[data-stop='1'] .factory-dispenser-knob {
  left: 50%;
}

[data-stop='2'] .factory-dispenser-knob {
  left: calc(38px - var(--dispenser-knob-w) / 2);
}

/* 定宽让两行的开关左右对齐: 140px = 最长的「向伊卡洛斯供应和回收」10 字 × 14px */
.factory-dispenser-mode-name {
  width: 140px;
  flex-shrink: 0;
  color: var(--fg-secondary);
  white-space: nowrap;
}

/* 文字色挂在行上: 文字在 label 外面，挂 label 上继承不到 */
.factory-selection-row:has(.factory-dispenser-check) {
  color: var(--fg-secondary);
}

.factory-dispenser-check {
  display: inline-flex;
  align-items: center;
  white-space: nowrap;
  cursor: pointer;
}

.factory-dispenser-bend {
  flex-shrink: 0;
  width: 12px;
  height: 12px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.3;
  stroke-linecap: round;
  stroke-linejoin: round;
  opacity: 0.75;
}

/* 缩进后箭头正落在上面那个勾选框下面 */
.factory-dispenser-sub {
  padding-left: 13px;
}

/* 三列: 标签 | 滑块 | 数值。滑块列给固定宽度，用 1fr 会随面板变长撑到文字里 */
.factory-dispenser-power {
  display: grid;
  grid-template-columns: 84px 130px 64px;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: var(--fg-secondary);
}

.factory-dispenser-range {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 4px;
  margin: 0;
  border-radius: 2px;
  background: linear-gradient(
    90deg,
    #4364eb 0%,
    #4364eb var(--factory-range-fill, 0%),
    #22304a var(--factory-range-fill, 0%),
    #22304a 100%
  );
  outline: none;
  cursor: pointer;
}

.factory-dispenser-range::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: var(--fg);
  border: 2px solid var(--accent);
}

.factory-dispenser-range::-moz-range-thumb {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--fg);
  border: 2px solid var(--accent);
}

.factory-dispenser-power-value {
  justify-self: end;
  color: var(--fg-value);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
</style>
