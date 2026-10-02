<script setup lang="ts">
/**
 * 工厂蓝图预览: 3D 场景由 lib/factory/FactoryPreview.js 负责，
 * 这里只管挂载 / 卸载画布与界面开关。
 */
import { onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { FactoryPreview } from '../../lib/factory/FactoryPreview.js'
import { attachPreview } from '../../stores/factory'

const canvasEl = ref<HTMLCanvasElement | null>(null)

/** 3D 场景实例: 挂载时创建，切走工具就销毁 */
let preview: FactoryPreview | null = null

/** 地基网格线开关 */
const showGrid = ref(true)

/**
 * 状态行里的一排显示层开关（key 就是 lib/factory/FactoryPreview.js 的层名）
 */
const layerState = reactive({ buildings: true, belts: true, inserters: true, icons: true })
const layerKeys = ['buildings', 'belts', 'inserters', 'icons'] as const
type LayerKey = typeof layerKeys[number]

/** 一个显示层的文案与提示 */
const LAYER_LABELS: Record<LayerKey, { text: string }> = {
  buildings: { text: '建筑' },
  belts: { text: '带子' },
  inserters: { text: '爪子' },
  icons: { text: '图标' },
}

/** 某个显示层当前是否显示 */
function layerOn(key: LayerKey) {
  return layerState[key]
}

/** 点一下工具条上的层按钮: 翻转该层并交给场景 */
function toggleLayer(key: LayerKey) {
  layerState[key] = !layerState[key]
  preview?.setLayerVisible(key, layerState[key])
}

/** 目标纬度: 南北下拉 + 0~90 输入框，默认「北 0°」 */
const targetNorth = ref<'N' | 'S'>('N')
const targetLatValue = ref(0)

/** 目标纬度（南为负） */
function currentTarget() {
  return (targetNorth.value === 'S' ? -1 : 1) * targetLatValue.value
}

/** 夹到 0~90，非数字当 0 */
function normalizeLatValue() {
  const value = Number(targetLatValue.value)
  targetLatValue.value = Number.isFinite(value) ? Math.min(90, Math.max(0, Math.round(value))) : 0
}

/** 提交: 回车 / 失焦（@change）都算，夹取后按新目标重摆；打字过程中不动场景 */
function commitLatValue() {
  normalizeLatValue()
  preview?.setTargetLatitude(currentTarget(), targetNorth.value === 'N')
}

onMounted(() => {
  if (!canvasEl.value) return
  preview = new FactoryPreview()
  preview.init(canvasEl.value)
  preview.setGridVisible(showGrid.value)
  // 先按界面上的开关设定各层，再摆蓝图（重摆时会照着开关跳过不显示的层）
  for (const key of layerKeys) preview.setLayerVisible(key, layerState[key])
  preview.setTargetLatitude(currentTarget(), targetNorth.value === 'N')
  attachPreview(preview)
})

onBeforeUnmount(() => {
  attachPreview(null)
  preview?.dispose()
  preview = null
})

// 网格线开关 → 场景
watch(showGrid, (visible) => preview?.setGridVisible(visible))

// 目标半球（下拉框）→ 立刻重摆
watch(targetNorth, () => preview?.setTargetLatitude(currentTarget(), targetNorth.value === 'N'))

/** 复位视角: 有蓝图回到蓝图中心，没有则回到默认视角，见 lib/factory/FactoryPreview.js */
function onResetView() {
  preview?.resetView()
}
</script>

<template>
  <h2>蓝图预览</h2>

  <div class="factory-preview">
    <div class="factory-preview-stage">
      <!-- draggable=false: 左键拖动挪观察点，别让浏览器把画布当成可拖拽的图片 -->
      <canvas ref="canvasEl" draggable="false"></canvas>

      <div class="factory-preview-hint">左键 / WASD 移动视角，中键转动视角</div>

      <div class="factory-preview-tools">
        <button class="btn-sm btn-ghost" type="button" @click="onResetView">复位视角</button>
      </div>
    </div>

    <div class="factory-preview-status">
      <label class="factory-preview-check">
        <input v-model="showGrid" type="checkbox" /> 显示网格线
      </label>
      <label class="factory-preview-check">
        目标纬度
        <select v-model="targetNorth" class="factory-preview-select">
          <option value="N">北</option>
          <option value="S">南</option>
        </select>
        <input
          v-model.number="targetLatValue"
          class="factory-preview-lat"
          type="number"
          min="0"
          max="90"
          step="1"
          @change="commitLatValue"
          @keyup.enter="commitLatValue"
        />
        <span class="factory-preview-unit">°</span>
      </label>

      <div class="factory-preview-layers">
        <button
          v-for="key in layerKeys"
          :key="key"
          class="btn-sm btn-ghost factory-layer-btn"
          :class="{ active: layerOn(key) }"
          type="button"
          :aria-pressed="layerOn(key)"
          @click="toggleLayer(key)"
        >
          {{ LAYER_LABELS[key].text }}
        </button>
      </div>
    </div>
  </div>
</template>
