<script setup lang="ts">
/** 制造设备的参数 */
import { computed, reactive, ref } from 'vue'
import { ACCELERATOR_MODE_NAMES, RESEARCH_MODE_NAMES, isLab } from '../../lib/blueprint/factory/factoryItems.js'
import { recipeName, recipeProductive } from '../../lib/blueprint/factory/factoryRecipes.js'
import { itemIconUrl } from '../../lib/markup/itemIcons'
import type { IconRef } from '../../lib/markup/itemIcons'
import { recipeCategoriesForBuilding } from '../../lib/markup/recipeCatalog'
import IconPickerModal from './IconPickerModal.vue'
import RecipeTip from './RecipeTip.vue'

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

/** 配方那行悬浮时贴着它画配方提示 */
const recipeHover = ref<HTMLElement | null>(null)

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
        <span
          class="factory-selection-recipe"
          @mouseenter="recipeHover = $event.currentTarget as HTMLElement"
          @mouseleave="recipeHover = null"
        >
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

    <!-- 配方提示: 悬浮配方那行时画 -->
    <RecipeTip :recipe-id="recipeId" :visible="recipeHover !== null" :anchor="recipeHover" />
  </div>
</template>

<style scoped>

/* 开关尺寸从这两个数推（钮 = 高 − 2×内边距） */
.factory-selection-accel {
  display: flex;
  align-items: center;
  gap: 8px;
  --accel-h: 15px;
  --accel-pad: 2px;
}

/* 胶囊 + 圆钮（钮在左 = 0 额外产出，在右 = 1 生产加速）。
   两挡颜色只在 --accel-color 上声明一次，轨道与挡位名都用它，所以两者必然同色 */
.factory-selection-switch {
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  padding: 0;
  border: none;
  background: none;
  cursor: pointer;
}

.factory-selection-switch-track {
  position: relative;
  flex: 0 0 auto;
  width: 30px;
  height: var(--accel-h);
  border-radius: calc(var(--accel-h) / 2);
  background: var(--accel-color, #5fd3f2);
  transition: background 0.15s ease;
}

.factory-selection-switch-knob {
  position: absolute;
  top: var(--accel-pad);
  left: var(--accel-pad);
  width: calc(var(--accel-h) - var(--accel-pad) * 2);
  height: calc(var(--accel-h) - var(--accel-pad) * 2);
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
  transition: transform 0.15s ease;
}

/* 钮在左内边；右挡时滑到右内边（30 − 钮 11 − 两侧内边距 4 = 15） */
.factory-selection-accel[data-mode='1'] .factory-selection-switch-knob {
  transform: translateX(15px);
}

.factory-selection-slider-name {
  min-width: 0;
  color: var(--accel-color, #5fd3f2);
  white-space: nowrap;
}

/* 生产加速那挡: 换一个变量，轨道与文字一起换色 */
.factory-selection-accel[data-mode='1'] {
  --accel-color: #ef9a5a;
}
</style>
