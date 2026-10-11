<script setup lang="ts">
/**
 * 物流运输站 / 大型采矿机的参数编辑（行星内 2103 / 星际 2104 / 大型采矿机 2316）
 *
 * 行星内只有运输机那几项，星际多出运输船最远路程 / 起送量、轨道采集器、曲速启用路程、翘曲器必备。
 * 大型采矿机只有开采速度与输出货物集装数量。
 * 滑杆上的值一律是「界面单位」，写回参数时由 codec 换算成原始 int32。
 */
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { itemIconUrl } from '../../lib/markup/itemIcons'
import type { IconCategories, IconRef } from '../../lib/markup/itemIcons'
import {
  LOGISTIC_ROLE_COLORS as ROLE_COLORS, LOGISTIC_ROLE_NAMES, LOCK_AMOUNT_NAMES, itemName,
} from '../../lib/blueprint/factory/factoryItems.js'
import IconPickerModal from './IconPickerModal.vue'
import FactorySelect from './FactorySelect.vue'

const props = defineProps<{
  /** 这栋建筑是哪一种（2103 行星内 / 2104 星际） */
  itemId: number
  /** 这栋建筑的参数对象 */
  parameters: Record<string, any>
  /** 物品图标（「物品」+「建筑」两类，物品栏的图标选择器用） */
  itemIcons: IconCategories
}>()

/** 改一项就报出去；父组件用 editParameters() 落进暂存，点保存才写回蓝图 */
const emit = defineEmits<{ change: [key: string, value: unknown] }>()

/** 拖动中的临时值（按字段 key / 栏位下标）: 只在松手时写回，免得每一帧都重摆预览 */
const dragging = reactive<Record<string, number>>({})
const draggingMax = reactive<Record<number, number>>({})

/** 物品上限: 吸附到 100 的倍数；行星内站每栏只有星际站的一半（实测 10000 / 20000） */
const MIN_ITEM_AMOUNT = 100
const MAX_ITEM_AMOUNT = 20000
const PLANET_ITEM_MAX = 10000
const ITEM_AMOUNT_STEP = 100

/** 运输船最远路程: 滑块 1~60 是有限路程，再往右一档（61）是不限（存 10000） */
const SHIP_LY_MAX = 60
const SHIP_LY_SLIDER_MAX = SHIP_LY_MAX + 1
const NO_LIMIT_LY = 10000

/** 开采速度: 界面单位是百分比（100%~300%），参数里存百分比 ×100（默认 10000 = 100%），滑杆 10% 一档 */
const MINING_SPEED_MIN = 100
const MINING_SPEED_MAX = 300
const MINING_SPEED_STEP = 10

/** 锁定循环: 不锁定 → 满仓 → 半仓 → 空仓 → 回到不锁定 */
const LOCK_CYCLE = [0, 1, 2, 3]
const nextLock = (lock: number) => LOCK_CYCLE[(LOCK_CYCLE.indexOf(Number(lock)) + 1) % LOCK_CYCLE.length]

/** 这栋是哪一种（星际站才有星际供需，上限也更大） */
const isStellar = computed(() => Number(props.itemId) === 2104)
/** 大型采矿机: 物品栏按本地塔显示，参数只剩开采速度与集装数量 */
const isMiner = computed(() => Number(props.itemId) === 2316)
/** 每栏上限的最大值 */
const itemMax = computed(() => (isStellar.value ? MAX_ITEM_AMOUNT : PLANET_ITEM_MAX))
/** 集装数量勾了「使用科技上限」（参数里 pilerCount = 0）*/
const pilerTech = computed(() => Number(props.parameters?.pilerCount ?? 0) === 0)
/** 物品栏（每项: 物品 / 上限 / 锁定 / 本地供需 / 星际供需） */
const storage = computed<any[]>(() => (Array.isArray(props.parameters?.storage) ? props.parameters.storage : []))

/** 夹到区间并按步长吸附（步长决定保留几位小数） */
function clamp(min: number, max: number, value: number, step = 1) {
  const bounded = Math.min(max, Math.max(min, value))
  const snapped = min + Math.round((bounded - min) / step) * step
  const decimals = step < 1 ? String(step).split('.')[1]?.length ?? 0 : 0
  return Number(snapped.toFixed(decimals))
}

/** 参数字段 ↔ 界面值的换算（noLimit: 到这一档显示成 noLimitText） */
type Scale = (v: number) => number
const SCALES: Record<string, { toUi: Scale, toRaw: Scale, unit: string, noLimit?: number, noLimitText?: string }> = {
  powerMW: { toUi: (mw) => mw, toRaw: (ui) => ui, unit: 'MW' },
  // 参数里存的是「夹角 α 的余弦」，界面上显示 α 本身
  droneDeg: { toUi: (deg) => deg, toRaw: (ui) => ui, unit: '°' },
  // 10000 = 不限（9999 ly 以上当不限，值那格显示「∞」）
  shipLy: {
    toUi: (ly) => clamp(1, SHIP_LY_SLIDER_MAX, ly > SHIP_LY_MAX ? SHIP_LY_SLIDER_MAX : ly),
    toRaw: (ui) => (ui >= SHIP_LY_SLIDER_MAX ? NO_LIMIT_LY : ui),
    unit: 'ly',
    noLimit: SHIP_LY_SLIDER_MAX,
    noLimitText: '∞',
  },
  warpAu: { toUi: (au) => au, toRaw: (ui) => ui, unit: 'AU' },
  percent: { toUi: (p) => p, toRaw: (ui) => ui, unit: '%' },
  // 大型采矿机开采速度: 参数里存百分比 ×100（10000 = 100%），界面显示百分比；
  // 参数里没写（0）时游戏按默认 100% 处理，这里也显示 100%
  miningSpeed: {
    toUi: (raw) => (raw > 0 ? raw / 100 : MINING_SPEED_MIN),
    toRaw: (ui) => Math.round(ui * 100),
    unit: '%',
  },
}

/** 行内勾选: 写回自己的字段（source 用于「使用科技上限」这种跟着滑块走的） */
type RowCheck = {
  key: string
  label: string
  /** 勾上写 on、取消写 off */
  on: number | boolean
  off: number | boolean
  source?: string
}

/** 一行滑块（第 4 格可能跟一个勾选） */
type Field = {
  key: string
  label: string
  /** 界面单位的区间与步长；星际站给了 stellarMin/stellarMax 就用那一对 */
  min?: number
  max?: number
  step?: number
  scale?: string
  stellarMin?: number
  stellarMax?: number
  /** 只有星际站才有 */
  stellar?: boolean
  check?: RowCheck
}

/** 输出货物集装数量: 1~4 是指定数量；「使用科技上限」（参数里存 0）由那个勾选管。 */
const PILER_FIELD: Field = {
  key: 'pilerCount', label: '输出货物集装数量', min: 1, max: 4, step: 1,
  check: { key: 'pilerCount', label: '使用科技上限', on: 0, off: 4, source: 'pilerCount' },
}

// 运输站行序: 充能功率 → 运输机路程 → 运输船路程(+轨道采集器) → 曲速启用路程(+翘曲器必备)
// → 两种起送量 → 集装数量(+使用科技上限)
const STATION_FIELDS: Field[] = [
  {
    // 行星内 12 MW 的原型 → 6~60；星际 60 MW 的原型 → 30~300
    key: 'workEnergyPerTick', label: '最大充能功率',
    min: 6, max: 60, step: 6, scale: 'powerMW',
    stellarMin: 30, stellarMax: 300,
  },
  { key: 'tripRangeOfDrones', label: '运输机最远路程', min: 20, max: 180, step: 1, scale: 'droneDeg' },
  {
    key: 'tripRangeOfShips', label: '运输船最远路程', min: 1, max: SHIP_LY_SLIDER_MAX, step: 1, scale: 'shipLy', stellar: true,
    check: { key: 'includeOrbitCollector', label: '轨道采集器', on: true, off: false },
  },
  {
    key: 'warpEnableDistance', label: '曲速启用路程', min: 0.5, max: 60, step: 0.5, scale: 'warpAu', stellar: true,
    check: { key: 'warperNecessary', label: '翘曲器必备', on: true, off: false },
  },
  { key: 'deliveryAmountOfDrones', label: '运输机起送量', min: 1, max: 100, step: 1, scale: 'percent' },
  { key: 'deliveryAmountOfShips', label: '运输船起送量', min: 1, max: 100, step: 1, scale: 'percent', stellar: true },
  PILER_FIELD,
]

// 大型采矿机行序: 开采速度 → 集装数量(+使用科技上限)
const MINER_FIELDS: Field[] = [
  {
    key: 'miningSpeed', label: '开采速度',
    min: MINING_SPEED_MIN, max: MINING_SPEED_MAX, step: MINING_SPEED_STEP, scale: 'miningSpeed',
  },
  PILER_FIELD,
]

/** 物品栏自己的两个开关（自动补充），排在物品栏下面一行；大型采矿机没有（游戏里那两个开关不显示） */
const SWITCHES: Field[] = [
  { key: 'droneAutoReplenish', label: '自动补充运输机' },
  { key: 'shipAutoReplenish', label: '自动补充运输船', stellar: true },
]

const fields = computed(() => (isMiner.value
  ? MINER_FIELDS
  : STATION_FIELDS.filter((f) => !f.stellar || isStellar.value)))
const switches = computed(() => (isMiner.value
  ? []
  : SWITCHES.filter((f) => !f.stellar || isStellar.value)))

/** 这一行的下限 / 上限（星际站取 stellarMin / stellarMax） */
const fieldMin = (field: Field) => (isStellar.value ? (field.stellarMin ?? field.min ?? 0) : (field.min ?? 0))
const fieldMax = (field: Field) => (isStellar.value ? (field.stellarMax ?? field.max ?? 100) : (field.max ?? 100))

/** 参数值 → 界面值（只过换算表，不钳位: 超范围的值要照实显示） */
function rawUi(field: Field) {
  const raw = Number(props.parameters?.[field.key] ?? 0)
  const scale = field.scale ? SCALES[field.scale].toUi : (v: number) => v
  return scale(Number.isFinite(raw) ? raw : 0)
}

/** 滑杆位置: 界面值钳到区间（超范围的就停在两端） */
const toUi = (field: Field) => clamp(fieldMin(field), fieldMax(field), rawUi(field), field.step ?? 1)

/** 滑杆当前位置: 拖动中用本地值；集装数量勾了科技上限就停在最右档 */
function sliderAt(field: Field) {
  if (dragging[field.key] !== undefined) return dragging[field.key]
  if (field.key === 'pilerCount' && pilerTech.value) return fieldMax(field)
  return toUi(field)
}

/** 数值那格: 显示参数里的真实值，拖动时跟着走 */
function display(field: Field) {
  if (field.key === 'pilerCount' && pilerTech.value) return '科技上限'
  const ui = dragging[field.key] ?? rawUi(field)
  const scale = field.scale ? SCALES[field.scale] : undefined
  if (scale?.noLimit !== undefined && ui >= scale.noLimit) return scale.noLimitText ?? '不限'
  const unit = scale?.unit ?? ''
  return unit ? `${ui} ${unit}` : String(ui)
}

/** 滑杆拖一下 / 松手: 拖动中只动本地值，松手才吸附并写回 */
function onSlide(field: Field, e: Event) {
  dragging[field.key] = clamp(fieldMin(field), fieldMax(field), Number((e.target as HTMLInputElement).value), field.step ?? 1)
}

function onCommit(field: Field, e: Event) {
  const el = e.target as HTMLInputElement
  const ui = clamp(fieldMin(field), fieldMax(field), Number(el.value), field.step ?? 1)
  dragging[field.key] = ui
  el.value = String(ui)
  const scale = field.scale ? SCALES[field.scale].toRaw : (v: number) => v
  emit('change', field.key, scale(ui))
}

/** 勾选: 切一下写回它自己那一项（「使用科技上限」写的是滑块那一项） */
function checkedOf(check: RowCheck) {
  const value = props.parameters?.[check.source ?? check.key]
  return check.on === 0 ? Number(value ?? 0) === 0 : !!value
}

function onCheck(check: RowCheck, e: Event) {
  const on = (e.target as HTMLInputElement).checked
  emit('change', check.source ?? check.key, on ? check.on : check.off)
}

/** 自动补充那两个开关 */
function onToggle(field: Field, e: Event) {
  emit('change', field.key, (e.target as HTMLInputElement).checked)
}

// ── 物品栏 ────────────────────────────────────────────────────
/** 锁定那一格的短文字（「不锁定」太长，按钮里放后半截） */
function lockText(lock: number) {
  const name = LOCK_AMOUNT_NAMES[Number(lock)] ?? LOCK_AMOUNT_NAMES[0]
  return name === '不锁定' ? '不锁' : name.replace('锁定', '')
}

/** 这一栏改了什么，就交一份新的 storage 出去 */
function emitStorage(index: number, patch: Record<string, any>) {
  const next = storage.value.map((row, i) => (i === index ? { ...row, ...patch } : { ...row }))
  emit('change', 'storage', next)
}

/** 上限输入框: 吸附到 100 的倍数并钳位，把规整过的值写回输入框 */
function onMaxInput(index: number, e: Event) {
  const el = e.target as HTMLInputElement
  const typed = Number(el.value)
  // 清空或敲了非法内容时退回下限，别把 NaN 写进参数
  const value = clamp(MIN_ITEM_AMOUNT, itemMax.value, Number.isFinite(typed) ? typed : MIN_ITEM_AMOUNT, ITEM_AMOUNT_STEP)
  el.value = String(value)
  emitStorage(index, { max: value })
}

/** 上限滑杆当前位置（拖动中用本地值；输入框跟着它实时变） */
const maxSliderAt = (index: number, row: any) => draggingMax[index] ?? Number(row.max ?? 0)

function onMaxSlide(index: number, e: Event) {
  draggingMax[index] = Number((e.target as HTMLInputElement).value)
}

function onMaxSlideCommit(index: number, e: Event) {
  const el = e.target as HTMLInputElement
  const value = clamp(MIN_ITEM_AMOUNT, itemMax.value, Number(el.value), ITEM_AMOUNT_STEP)
  el.value = String(value)
  delete draggingMax[index]
  emitStorage(index, { max: value })
}

// ── 物品图标选择器 ────────────────────────────────────────────
const picker = reactive({
  open: false,
  index: 0,
  anchor: null as HTMLElement | null,
})
const iconEls = ref<HTMLElement[]>([])

/** 打开某一栏的图标选择器（浮层贴在那一格的图标上） */
async function openPicker(index: number) {
  picker.index = index
  await nextTick()
  picker.anchor = iconEls.value[index] ?? null
  picker.open = true
}

function onPickItem(icon: IconRef) {
  emitStorage(picker.index, { itemId: Number(icon.id) })
  picker.open = false
  picker.anchor = null
}

// 参数对象换了（选了别的塔 / 换蓝图）就清掉拖动中的临时值，别让它盖住新值
watch(() => props.parameters, () => {
  for (const key of Object.keys(dragging)) delete dragging[key]
  for (const key of Object.keys(draggingMax)) delete draggingMax[key]
})

// 勾上 / 取消「使用科技上限」时，也要清掉这一行拖出来的临时值（否则它会盖住「停在最右档」）
watch(pilerTech, () => {
  delete dragging.pilerCount
})
</script>

<template>
  <div class="factory-station">
    <!-- 物品栏: 一栏三格 —— 图标 | 上限盒 | 供需盒 -->
    <div class="factory-station-storage">
      <div v-for="(row, index) in storage" :key="index" class="factory-storage-row">
        <button
          :ref="(el) => { if (el) iconEls[index] = el as HTMLElement }"
          class="factory-storage-icon"
          type="button"
          :title="row.itemId ? itemName(Number(row.itemId)) : '选择物品'"
          @click="openPicker(index)"
        >
          <img v-if="Number(row.itemId) > 0" class="factory-icon" :src="itemIconUrl(Number(row.itemId))" :alt="itemName(Number(row.itemId))" />
          <span v-else class="factory-storage-empty">+</span>
        </button>

        <div class="factory-storage-value-box">
          <div class="factory-storage-value-head">
            <input
              class="factory-storage-value"
              type="number"
              :min="MIN_ITEM_AMOUNT"
              :max="itemMax"
              :step="ITEM_AMOUNT_STEP"
              :value="maxSliderAt(index, row)"
              @change="onMaxInput(index, $event)"
            />
            <button
              class="factory-storage-lock"
              type="button"
              @click="emitStorage(index, { lockAmount: nextLock(Number(row.lockAmount ?? 0)) })"
            >{{ lockText(Number(row.lockAmount ?? 0)) }}</button>
          </div>
          <input
            class="factory-station-range factory-storage-range"
            type="range"
            min="0"
            :max="itemMax"
            :step="ITEM_AMOUNT_STEP"
            :value="maxSliderAt(index, row)"
            :style="{ '--factory-range-fill': `${(maxSliderAt(index, row) / itemMax) * 100}%` }"
            @input="onMaxSlide(index, $event)"
            @change="onMaxSlideCommit(index, $event)"
          />
        </div>

        <div class="factory-storage-roles">
          <FactorySelect
            class="factory-storage-role-local"
            :model-value="Number(row.localRole ?? 0)"
            :options="LOGISTIC_ROLE_NAMES"
            :colors="ROLE_COLORS"
            prefix="本地"
            @update:model-value="(v) => emitStorage(index, { localRole: v })"
          />
          <FactorySelect
            v-if="isStellar"
            class="factory-storage-role-remote"
            :model-value="Number(row.remoteRole ?? 0)"
            :options="LOGISTIC_ROLE_NAMES"
            :colors="ROLE_COLORS"
            prefix="星际"
            @update:model-value="(v) => emitStorage(index, { remoteRole: v })"
          />
        </div>
      </div>
    </div>

    <!-- 自动补充 -->
    <div v-if="switches.length" class="factory-station-autofill">
      <label v-for="field in switches" :key="field.key" class="factory-station-check">
        <input
          type="checkbox"
          :checked="!!parameters?.[field.key]"
          @change="onToggle(field, $event)"
        />
        <span>{{ field.label }}</span>
      </label>
    </div>

    <!-- 参数 -->
    <div class="factory-station-params">
      <div v-for="field in fields" :key="field.key" class="factory-station-row">
        <span class="factory-station-label">{{ field.label }}</span>

        <input
          class="factory-station-range"
          type="range"
          :min="fieldMin(field)"
          :max="fieldMax(field)"
          :step="field.step"
          :value="sliderAt(field)"
          :disabled="field.key === 'pilerCount' && pilerTech"
          :style="{ '--factory-range-fill': `${((sliderAt(field) - fieldMin(field)) / (fieldMax(field) - fieldMin(field))) * 100}%` }"
          @input="onSlide(field, $event)"
          @change="onCommit(field, $event)"
        />
        <span class="factory-station-value">{{ display(field) }}</span>

        <label v-if="field.check" class="factory-station-check">
          <input
            type="checkbox"
            :checked="checkedOf(field.check)"
            @change="onCheck(field.check, $event)"
          />
          <span>{{ field.check.label }}</span>
        </label>
      </div>
    </div>

    <!-- 物品选择器 -->
    <IconPickerModal
      :open="picker.open"
      :categories="itemIcons"
      :current="Number(storage[picker.index]?.itemId ?? 0)"
      :anchor="picker.anchor"
      title="选择物品"
      @select="onPickItem"
      @close="picker.open = false"
    />
  </div>
</template>

<style scoped>
/* 三段竖排: 物品栏 → 自动补充 → 参数区 */
.factory-station {
  display: flex;
  flex-direction: column;
}

/* ── 滑块（参数区与物品栏共用轨道的画法）──
   --factory-range-fill 由组件按比例给出 */
.factory-station-range {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  min-width: 40px;
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

.factory-station-range::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: var(--fg);
  border: 2px solid var(--accent);
}

.factory-station-range::-moz-range-thumb {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--fg);
  border: 2px solid var(--accent);
}

/* 「使用科技上限」勾上时停在上限位置并置灰 */
.factory-station-range:disabled {
  cursor: default;
  opacity: 0.45;
}

/* ── 参数区: 四列 —— 标签 | 滑块 | 数值 | 勾选。标签与数值定宽、勾选按内容，
   只有滑块那列弹性，所以每行滑块一样长、数值右边缘也齐平 ── */
.factory-station-params {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--line-faint);   /* 与上面那一段的分隔线 */
}

.factory-station-row {
  display: grid;
  grid-template-columns: 104px minmax(100px, 124px) 62px 96px;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}

/* 104px 刚好放得下最长的「输出货物集装数量」 */
.factory-station-label {
  grid-column: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--fg-secondary);
  white-space: nowrap;
}

/* 第 3 列定宽（「10000 ly」也放得下），右对齐 */
.factory-station-value {
  grid-column: 3;
  justify-self: end;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--fg-value);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.factory-station-check {
  grid-column: 4;
  justify-self: start;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--fg-secondary);
  white-space: nowrap;
  cursor: pointer;
}

/* 用原生 checkbox，整行给个手型 */
.factory-station-row:has(input[type='checkbox']) {
  cursor: pointer;
}

.factory-station-autofill {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 10px;
  margin-top: 6px;
  font-size: 13px;
}

/* ── 物品栏: 一栏三格 —— 图标 | 上限盒 | 供需盒 ── */
.factory-station-storage {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* 上限盒与供需盒里的控件都取 --storage-line-h，保证等高 */
.factory-storage-row {
  --storage-line-h: 22px;
  display: grid;
  grid-template-columns: 47px minmax(0, 1fr) auto;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-radius: 5px;
  background: #141d2e;
}

.factory-storage-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  align-self: center;
  justify-self: start;
  width: 47px;
  height: 47px;
  padding: 0;
  border-radius: 4px;
  border: 1px solid var(--line-strong);
  background: var(--bg-slot);
  color: #6f8ec0;
  cursor: pointer;
}

.factory-storage-icon:hover {
  border-color: var(--accent);
}

.factory-storage-icon .factory-icon {
  width: 80%;
  height: 80%;
}

.factory-storage-empty {
  font-size: 18px;
  line-height: 1;
}

/* 两行: 上面 [输入框 + 锁定] 左右对齐，下面滑块占满盒宽 */
.factory-storage-value-box {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.factory-storage-value-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  min-width: 0;
  height: var(--storage-line-h);
}

.factory-storage-value {
  width: 76px;
  height: var(--storage-line-h, 22px);
  box-sizing: border-box;
  padding: 0 4px;
  border-radius: 4px;
  border: 1px solid var(--line-strong);
  background: var(--bg-slot);
  color: var(--fg-value);
  font-family: inherit;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}

.factory-storage-value:focus {
  outline: none;
  border-color: var(--accent);
}

/* 点一下换下一种，循环: 不锁定 → 满仓 → 半仓 → 空仓 */
.factory-storage-lock {
  flex: 0 0 auto;
  padding: 1px 4px;
  border-radius: 4px;
  border: 1px solid var(--line-strong);
  background: var(--bg-slot);
  color: var(--fg-icon);
  font-size: 11px;
  white-space: nowrap;
  cursor: pointer;
}

.factory-storage-lock:hover {
  border-color: var(--accent);
  color: var(--fg-strong);
}

/* 高度与输入框一样，细轨画在中间（多出来的高度只是可点区域） */
.factory-storage-range {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  min-width: 0;
  height: var(--storage-line-h, 22px);
  padding: 0;
  margin: 0;
  border: none;
  background: none;
  outline: none;
  cursor: pointer;
}

.factory-storage-range::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 2px;
  background: linear-gradient(
    90deg,
    #4364eb 0%,
    #4364eb var(--factory-range-fill, 0%),
    #22304a var(--factory-range-fill, 0%),
    #22304a 100%
  );
}

.factory-storage-range::-moz-range-track {
  height: 4px;
  border-radius: 2px;
  background: var(--line-faint);
}

.factory-storage-range::-moz-range-progress {
  height: 4px;
  border-radius: 2px;
  background: var(--accent);
}

/* 轨 4px、钮 11px → 上移 (11 − 4) / 2 */
.factory-storage-range::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 11px;
  height: 11px;
  margin-top: -3.5px;
  border-radius: 50%;
  background: var(--fg);
  border: 2px solid var(--accent);
}

.factory-storage-range::-moz-range-thumb {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--fg);
  border: 2px solid var(--accent);
}

/* 竖直居中（行星内站只有「本地」，于是落在这一栏正中） */
.factory-storage-roles {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 3px;
}

/* 本地在上、星际在下（class 落在 FactorySelect 的根 span 上，所以要用 :deep 穿进去） */
.factory-storage-roles :deep(.factory-storage-role-local) {
  grid-row: 1;
}

.factory-storage-roles :deep(.factory-storage-role-remote) {
  grid-row: 2;
}
</style>
