<script setup lang="ts">
/** 制造设备的参数 */
import { computed, reactive } from 'vue'
import { ACCELERATOR_MODE_NAMES, RESEARCH_MODE_NAMES, isLab } from '../../lib/blueprint/factory/factoryItems.js'
import { recipeName, recipeProductive } from '../../lib/blueprint/factory/factoryRecipes.js'
import { itemIconUrl } from '../../lib/markup/itemIcons'
import type { IconRef } from '../../lib/markup/itemIcons'
import { recipeCategoriesForBuilding } from '../../lib/markup/recipeCatalog'
import IconPickerModal from './IconPickerModal.vue'

const props = defineProps<{
  /** 建筑id */
  itemId: number
  /** 配方 id（0 = 未指定） */
  recipeId: number
  /** 这栋建筑的参数对象 */
  parameters: Record<string, any>
}>()

const emit = defineEmits<{
  /** 参数变了（研究模式 / 增产模式）；父组件落进暂存，点保存才写回蓝图 */
  change: [key: string, value: unknown]
  /** 换了一个配方；父组件落进暂存，点保存才写回蓝图 */
  'update:recipeId': [number]
}>()

/** 研究站才有「模式」这一行 */
const lab = computed(() => isLab(props.itemId))
/** 研究站选了矩阵合成（= 1）或不是研究站时，才用配方 */
const useRecipe = computed(() => !lab.value || Number(props.parameters?.researchMode ?? 0) === 1)

/** 配方图标与名字 */
const recipeIcon = computed(() => itemIconUrl(props.recipeId > 0 ? 20000 + props.recipeId : 504))
const recipeText = computed(() => {
  if (props.recipeId <= 0) return '未指定配方'
  return recipeName(props.recipeId) || `未知配方_${props.recipeId}`
})

/** 这栋的配方是不是只能「加速生产」 */
const fixedAccelerator = computed(() => props.recipeId > 0 && !recipeProductive(props.recipeId))
const acceleratorMode = computed(() => Number(props.parameters?.acceleratorMode ?? 0))

/** 配方浮层 */
const picker = reactive({
  open: false,
  anchor: null as HTMLElement | null,
})

function openPicker(e: MouseEvent) {
  picker.anchor = e.currentTarget as HTMLElement
  picker.open = true
}

function onPick(icon: IconRef) {
  if (icon.recipeId !== undefined) emit('update:recipeId', icon.recipeId)
}
</script>

<template>
  <div class="factory-selection-params">
    <div v-if="lab" class="factory-selection-row factory-selection-param">
      <span class="factory-selection-label">模式</span>
      <select
        class="factory-selection-select"
        :value="Number(parameters?.researchMode ?? 0)"
        @change="emit('change', 'researchMode', Number(($event.target as HTMLSelectElement).value))"
      >
        <option v-for="(name, value) in RESEARCH_MODE_NAMES" :key="value" :value="Number(value)">{{ name }}</option>
      </select>
    </div>

    <template v-if="useRecipe">
      <div class="factory-selection-row factory-selection-param">
        <span class="factory-selection-label">配方</span>
        <span class="factory-selection-recipe">
          <img v-if="recipeIcon" class="factory-icon factory-selection-icon" :src="recipeIcon" :alt="recipeText" />
          <span class="factory-selection-value">{{ recipeText }}</span>
        </span>
        <button class="factory-selection-btn" type="button" @click="openPicker">
          <svg viewBox="0 0 16 16" width="12" height="12">
            <path d="M10.5 2.6a1.6 1.6 0 0 1 2.3 2.3L5.6 12.1l-3 .7.7-3z" />
            <path d="M9.6 3.5l2.3 2.3" />
          </svg>
        </button>
      </div>

      <div
        class="factory-selection-row factory-selection-param factory-selection-accel"
        :data-mode="fixedAccelerator ? '1' : String(acceleratorMode)"
      >
        <span class="factory-selection-label">增产模式</span>
        <span class="factory-selection-slider-name">
          {{ fixedAccelerator ? '仅加速生产' : (ACCELERATOR_MODE_NAMES[acceleratorMode] ?? acceleratorMode) }}
        </span>
        <button
          v-if="!fixedAccelerator"
          class="factory-selection-switch"
          type="button"
          @click="emit('change', 'acceleratorMode', acceleratorMode === 1 ? 0 : 1)"
        >
          <span class="factory-selection-switch-track">
            <span class="factory-selection-switch-knob"></span>
          </span>
        </button>
      </div>
    </template>

    <!-- 配方浮层 -->
    <IconPickerModal
      :open="picker.open"
      :categories="recipeCategoriesForBuilding(itemId)"
      :current="recipeId > 0 ? 20000 + recipeId : 0"
      :anchor="picker.anchor"
      title="选择配方"
      @select="onPick"
      @close="picker.open = false"
    />
  </div>
</template>
