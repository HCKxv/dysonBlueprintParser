<script setup lang="ts">
/**
 * 批量编辑
 */
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import IconPickerModal from './IconPickerModal.vue'
import { applyBatchEdit, batchRules } from '../../stores/factory'
import type { BatchRule } from '../../stores/factory'
import { BATCH_RULE_TYPES } from '../../lib/factory/batch.js'
import { recipeCategoriesAll, recipeCategoriesOfType } from '../../lib/markup/recipeCatalog'
import { recipeName, recipeType } from '../../lib/blueprint/factory/factoryRecipes.js'
import { itemName } from '../../lib/blueprint/factory/factoryItems.js'
import { ACCELERATOR_MODE_NAMES } from '../../lib/blueprint/factory/factoryItems.js'
import { ICON_CATEGORIES } from '../../lib/markup/iconCatalog'
import { itemIconUrl } from '../../lib/markup/itemIcons'
import type { IconCategories, IconRef } from '../../lib/markup/itemIcons'
import { useToast } from '../../composables/useToast'

const toast = useToast()

/** 配方图标 id = 20000 + 配方 id */
const RECIPE_ICON_BASE = 20000

/** 浮窗标题 */
const PICKER_NOUN: Record<string, string> = {
  recipe: '配方',
  upgrade: '建筑',
  stationItem: '物品',
  filter: '物品',
}

/** 增产模式下拉选项（替换配方用）: 「不替换」= null */
const ACCELERATOR_OPTIONS: { value: string, label: string }[] = [
  { value: 'null', label: '不替换' },
  ...Object.entries(ACCELERATOR_MODE_NAMES).map(([value, label]) => ({ value, label })),
]

/** 下拉当前该显示哪一项 */
function acceleratorValue(rule: BatchRule): string {
  const value = rule.options?.acceleratorMode
  return value === null || value === undefined ? 'null' : String(value)
}

/** 选了增产模式: 'null' 记号转回 null，其余转成挡位数字 */
function onAcceleratorChange(rule: BatchRule, e: Event) {
  const raw = (e.target as HTMLSelectElement).value
  rule.options.acceleratorMode = raw === 'null' ? null : Number(raw)
}

/** 「类型」下拉的选项（替换物品过滤用，跟 batch.js 的 editFilter 对应） */
const FILTER_TARGETS = ['全部', '分拣器', '四向', '配送器']

/** 选了要改哪些建筑上的过滤 */
function onTargetChange(rule: BatchRule, e: Event) {
  rule.options.target = (e.target as HTMLSelectElement).value
}

/** 物流塔物品替换: 物品 + 建筑两类 */
const ITEM_CATEGORIES: IconCategories = (() => {
  const out: IconCategories = {}
  for (const name of ['物品', '建筑']) {
    const list = ICON_CATEGORIES[name]
    if (list) out[name] = list
  }
  return out
})()

/** 建筑 id → 浮窗里的一项 */
function buildingEntry(id: number): IconRef {
  return { id, name: itemName(id) || `#${id}` }
}

/** 可升降级的建筑 */
const UPGRADE_GROUPS = [
  { label: '传送带', items: [2001, 2002, 2003] },
  { label: '分拣器', items: [2011, 2012, 2013, 2014] },
  { label: '熔炉', items: [2302, 2315, 2319] },
  { label: '化工厂', items: [2309, 2317] },
  { label: '制造台', items: [2303, 2304, 2305, 2318] },
  { label: '研究站', items: [2901, 2902] },
]

/** 这栋建筑属于哪一组可升降级建筑；不在表里给 null */
function upgradeGroupOf(itemId: unknown) {
  const id = Number(itemId) || 0
  return UPGRADE_GROUPS.find((group) => group.items.includes(id)) ?? null
}

/** 可升降级建筑的浮窗选项 */
const UPGRADE_CATEGORIES: IconCategories = {
  可升降级建筑: UPGRADE_GROUPS.flatMap((group) => group.items.map(buildingEntry)),
}

/** 「添加规则」的下拉框 */
const addOpen = ref(false)
const addBox = ref<HTMLElement | null>(null)

/** 选择浮窗: 给哪条规则的哪个格子选 */
const picker = reactive({
  open: false,
  rule: null as BatchRule | null,
  /** from = 被替换；to = 替换为（只在被替换那一类/组里选） */
  field: 'from' as 'from' | 'to',
  anchor: null as HTMLElement | null,
})

/** 规则类型的中文名 */
function labelOf(type: string): string {
  return BATCH_RULE_TYPES.find((item) => item.id === type)?.label ?? type
}

/** 格子里的图标地址: 配方图标 id = 20000 + 配方 id，物品 / 建筑直接用 id；0（没选）给空串 */
function slotIcon(rule: BatchRule, id: unknown): string {
  const value = Number(id) || 0
  if (value <= 0) return ''
  return itemIconUrl(rule.type === 'recipe' ? RECIPE_ICON_BASE + value : value)
}

/** 格子里的名字: 现在只用作图片的 alt */
function slotText(rule: BatchRule, id: unknown): string {
  const value = Number(id) || 0
  if (value <= 0) return ''
  if (rule.type === 'recipe') return recipeName(value) || `未知配方_${value}`
  return itemName(value) || `未知物品_${value}`
}

// ── 规则数组 ──────────────────────────────────────────────

/** 加一条空规则 */
function addRule(typeId: string) {
  const type = BATCH_RULE_TYPES.find((item) => item.id === typeId)
  if (!type) return
  batchRules.value.push({ type: type.id, options: { ...type.options() } })
  addOpen.value = false
}

function removeRule(index: number) {
  const rule = batchRules.value[index]
  if (!rule) return
  if (picker.rule === rule) picker.open = false
  batchRules.value.splice(index, 1)
}

/** 点「添加规则」的外面就收起来 */
function onDocMouseDown(e: MouseEvent) {
  if (!addBox.value?.contains(e.target as Node)) addOpen.value = false
}

watch(addOpen, (open) => {
  if (open) document.addEventListener('mousedown', onDocMouseDown)
  else document.removeEventListener('mousedown', onDocMouseDown)
})

onBeforeUnmount(() => document.removeEventListener('mousedown', onDocMouseDown))

// ── 选择浮窗 ──────────────────────────────────────────────

function openPicker(rule: BatchRule, field: 'from' | 'to', e: MouseEvent) {
  // 「替换为」要先有「被替换」: 不知道类型就不知道该列哪些配方
  if (field === 'to' && !(Number(rule.options.from) > 0)) return
  picker.rule = rule
  picker.field = field
  picker.anchor = e.currentTarget as HTMLElement
  picker.open = true
}

/** 浮窗里列哪些项: 按规则类型和当前格子定 */
const pickerCategories = computed<IconCategories>(() => {
  const rule = picker.rule
  if (!rule) return {}

  if (rule.type === 'recipe') {
    // 被替换 = 全量配方；替换为 = 被替换那个配方所属类型里的配方
    if (picker.field === 'from') return recipeCategoriesAll()
    return recipeCategoriesOfType(recipeType(Number(rule.options.from) || 0))
  }

  if (rule.type === 'upgrade') {
    // 被替换 = 全部可升降级建筑；替换为 = 同组里的建筑（都放一个分类，不显示分类按钮）
    if (picker.field === 'from') return UPGRADE_CATEGORIES
    const group = upgradeGroupOf(rule.options.from)
    return group ? { 可升降级建筑: group.items.map(buildingEntry) } : {}
  }

  // 物流塔物品替换: 物品 + 建筑
  return ITEM_CATEGORIES
})

/** 浮窗标题: 选择 + 这一类东西的名字 */
const pickerTitle = computed(() => `选择${PICKER_NOUN[picker.rule?.type ?? ''] ?? ''}`)

/** 当前这一格上的图标 id（高亮用）: 配方要加 20000 的基数，物品 / 建筑就是 id 本身 */
const pickerCurrent = computed(() => {
  const rule = picker.rule
  const id = Number(rule?.options?.[picker.field]) || 0
  if (!id) return 0
  return rule?.type === 'recipe' ? RECIPE_ICON_BASE + id : id
})

/** 「替换为」这一格还合不合法（换了被替换之后） */
function toStillValid(rule: BatchRule, to: number): boolean {
  if (rule.type === 'recipe') return recipeType(to) === recipeType(Number(rule.options.from) || 0)
  if (rule.type === 'upgrade') return !!upgradeGroupOf(rule.options.from)?.items.includes(to)
  return true // 物流塔物品替换: 物品 / 建筑都能换，不受被替换限制
}

function onPick(icon: IconRef) {
  const rule = picker.rule
  if (!rule) return
  // 配方取 recipeId，物品 / 建筑取图标 id（= 物品 id）
  const value = rule.type === 'recipe' ? Number(icon?.recipeId) || 0 : Number(icon?.id) || 0
  if (!value) return

  rule.options[picker.field] = value
  // 换了「被替换」就换了可选项，原来的「替换为」可能已经不在里头 → 清掉重选
  const to = Number(rule.options.to) || 0
  if (picker.field === 'from' && to > 0 && !toStillValid(rule, to)) rule.options.to = 0

  picker.open = false
}

// ── 确认 ──────────────────────────────────────────────────

function onConfirm() {
  const res = applyBatchEdit()
  if (!res.ok) {
    toast.show(res.message)
    return
  }
  // 浮窗可能正指着一条已经没了的规则，关掉
  picker.open = false
  toast.show('已应用规则')
}
</script>

<template>
  <div class="factory-batch">
    <!-- 规则数组: 一项一行（三条规则都是「被替换 → 替换为」，渲染方式一样） -->
    <div v-if="batchRules.length" class="factory-batch-list">
      <div v-for="(rule, index) in batchRules" :key="index" class="factory-batch-rule">
        <span class="factory-batch-label">{{ labelOf(rule.type) }}：</span>

        <button
          class="factory-batch-slot"
          type="button"
          @click="openPicker(rule, 'from', $event)"
        >
          <img
            v-if="rule.options.from"
            class="factory-icon"
            :src="slotIcon(rule, rule.options.from)"
            :alt="slotText(rule, rule.options.from)"
          />
          <!-- 没选: 空方框 + 加号 -->
          <svg v-else viewBox="0 0 16 16">
            <path d="M8 3.4v9.2" />
            <path d="M3.4 8h9.2" />
          </svg>
        </button>

        <span class="factory-batch-arrow">
          <svg viewBox="0 0 16 16">
            <path d="M2.8 8h10.2" />
            <path d="M9.4 4.4 13 8l-3.6 3.6" />
          </svg>
        </span>

        <button
          class="factory-batch-slot"
          type="button"
          :disabled="!rule.options.from"
          @click="openPicker(rule, 'to', $event)"
        >
          <img
            v-if="rule.options.to"
            class="factory-icon"
            :src="slotIcon(rule, rule.options.to)"
            :alt="slotText(rule, rule.options.to)"
          />
          <svg v-else viewBox="0 0 16 16">
            <path d="M8 3.4v9.2" />
            <path d="M3.4 8h9.2" />
          </svg>
        </button>

        <!-- 替换配方: 增产模式（不替换 = null） -->
        <template v-if="rule.type === 'recipe'">
          <span class="factory-batch-label factory-batch-accel">增产模式</span>
          <select
            class="factory-batch-select"
            :value="acceleratorValue(rule)"
            @change="onAcceleratorChange(rule, $event)"
          >
            <option v-for="opt in ACCELERATOR_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
          </select>
        </template>

        <!-- 替换物品过滤: 类型（改哪些建筑上的过滤） -->
        <template v-if="rule.type === 'filter'">
          <span class="factory-batch-label factory-batch-accel">类型</span>
          <select
            class="factory-batch-select"
            :value="rule.options.target"
            @change="onTargetChange(rule, $event)"
          >
            <option v-for="name in FILTER_TARGETS" :key="name" :value="name">{{ name }}</option>
          </select>
        </template>

        <button
          class="factory-batch-remove"
          type="button"
          @click="removeRule(index)"
        >
          <svg viewBox="0 0 16 16">
            <path d="M4.4 4.4 11.6 11.6" />
            <path d="M11.6 4.4 4.4 11.6" />
          </svg>
        </button>
      </div>
    </div>

    <!-- 添加规则: 跟规则项同尺寸的一整行，点开类型下拉；满 6 条就不显示 -->
    <div v-if="batchRules.length < 6" ref="addBox" class="factory-batch-add">
      <button class="factory-batch-rule factory-batch-plus" type="button" @click="addOpen = !addOpen">
        <svg viewBox="0 0 16 16">
          <path d="M8 3.4v9.2" />
          <path d="M3.4 8h9.2" />
        </svg>
      </button>
      <div v-if="addOpen" class="factory-batch-menu">
        <button
          v-for="type in BATCH_RULE_TYPES"
          :key="type.id"
          class="factory-batch-menu-item"
          type="button"
          @click="addRule(type.id)"
        >{{ type.label }}</button>
      </div>
    </div>

    <!-- 提交 -->
    <div class="factory-batch-actions">
      <button
        class="btn-sm factory-batch-confirm"
        type="button"
        :disabled="!batchRules.length
          || batchRules.some((rule) => !rule.options.from || !rule.options.to)"
        @click="onConfirm"
      >确认</button>
    </div>
  </div>

  <!-- 配方浮窗 -->
  <IconPickerModal
    :open="picker.open"
    :categories="pickerCategories"
    :current="pickerCurrent"
    :anchor="picker.anchor"
    :title="pickerTitle"
    @select="onPick"
    @close="picker.open = false"
  />
</template>
