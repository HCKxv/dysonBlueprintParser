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
          @click="toggleLayer(key)"
        >
          {{ LAYER_LABELS[key].text }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.factory-preview {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
  min-height: 0;
}

/* 尺寸由 CSS 定，渲染器跟着它走（ResizeObserver） */
.factory-preview-stage {
  position: relative;
  flex: 1;
  min-height: 240px;
  border-radius: 16px;
  overflow: hidden;
  border: 1px solid #1b2740;
  background: var(--bg-stage);
}

.factory-preview-stage canvas {
  width: 100%;
  height: 100%;
  display: block;
  /* 压掉左键拖动时的文本选择 / 原生拖拽 */
  user-select: none;
  -webkit-user-select: none;
}

/* 画布左下角。pointer-events: none 让左键拖动不会点在提示上 */
.factory-preview-hint {
  position: absolute;
  left: 10px;
  bottom: 10px;
  max-width: calc(100% - 20px);
  padding: 2px 0;
  color: var(--fg-secondary);
  font-size: 12px;
  line-height: 1.5;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.75);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
  z-index: 2;
}

/* 复位视角: 舞台右下角 */
.factory-preview-tools {
  position: absolute;
  right: 10px;
  bottom: 10px;
  display: flex;
  gap: 4px;
  z-index: 2;
}

/* 状态行: 状态标签 + 网格线开关 + 目标纬度 + 显示层开关 */
.factory-preview-status {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  font-size: 11px;
  flex-shrink: 0;
}

.factory-preview-check {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: 4px;
  padding-left: 8px;
  border-left: 1px solid var(--line-faint);
  font-size: 12px;
  color: var(--fg-secondary);
  white-space: nowrap;
  cursor: pointer;
}

/* 目标纬度下拉: 跟状态栏同一套深色描边 */
.factory-preview-select {
  padding: 1px 4px;
  border-radius: 4px;
  background: var(--bg-inset);
  border: 1px solid var(--line-inset);
  color: var(--fg-secondary);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
}

.factory-preview-select:focus {
  outline: none;
  border-color: #2f6bb5;
}

.factory-preview-lat {
  width: 44px;
  padding: 1px 4px;
  border-radius: 4px;
  background: var(--bg-inset);
  border: 1px solid var(--line-inset);
  color: var(--fg-secondary);
  font-size: 12px;
  font-family: inherit;
  text-align: right;
}

.factory-preview-lat:focus {
  outline: none;
  border-color: #2f6bb5;
}

/* 这么窄的框里放不下上下箭头 */
.factory-preview-lat::-webkit-outer-spin-button,
.factory-preview-lat::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.factory-preview-unit {
  margin-left: -2px;
  color: #8a97ae;
}

/* 显示层开关: 推到状态行最右，与「目标纬度」同一行 */
.factory-preview-layers {
  display: flex;
  gap: 4px;
  margin-left: auto;   /* 推到状态行最右，与「目标纬度」同一行 */
}

.factory-layer-btn {
  text-align: center;
  white-space: nowrap;
}

/* 亮着 = 该层显示；关掉时退回 btn-ghost 的暗底色 */
.factory-layer-btn.active,
.factory-layer-btn.active:hover {
  background: #24405f;
  border-color: #3d6f9e;
  color: var(--fg-strong);
}
</style>
