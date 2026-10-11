<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { PaintingPreview } from '../../lib/painting/PaintingPreview.js'
import {
  painting,
  currentMode,
  paintResult,
  paintStats,
  foundationResult,
  foundationStats,
  generating,
  defaultViewLng,
  isFoundationMode,
  planetGrid,
  quantizedCropRect,
} from '../../stores/painting'
import { downloadCanvas } from '../../utils/download'
import { drawQuantizedImage } from '../../lib/painting/quantize.js'
import { useToast } from '../../composables/useToast'

const toast = useToast()
const canvasEl = ref<HTMLCanvasElement | null>(null)

// 3D 预览

let preview: PaintingPreview | null = null

/** 预览用的网格类型: 戴森球蓝图看涂色网格，地基蓝图看行星地基网格 */
const gridKind = computed(() => (isFoundationMode.value ? 'planet' : 'dyson'))

onMounted(() => {
  if (!canvasEl.value) return
  preview = new PaintingPreview()
  // 先定好网格类型（init 里会按它建几何），再初始化
  preview.setGridKind(gridKind.value, planetGrid)
  preview.init(canvasEl.value)
  preview.setGridVisible(painting.showGridLines)
  preview.setPainting(paintResult.value)
  preview.setFoundationPaint(foundationResult.value)
  preview.setCenterLongitude(defaultViewLng.value)
  refreshFlatMap()
})

onBeforeUnmount(() => {
  preview?.dispose()
  preview = null
})

// store 变化 → 同步给预览
watch(paintResult, (fg) => preview?.setPainting(fg))
watch(foundationResult, (p) => {
  preview?.setFoundationPaint(p)
  refreshFlatMap()
})
watch(() => painting.showGridLines, (v) => preview?.setGridVisible(v))
// 默认视角正视的经线变了（经度偏移或切投影模式），跟着转过去
watch(defaultViewLng, (v) => preview?.setCenterLongitude(v))

// 切换生成模式 → 换网格 + 重出展开图
watch(gridKind, (kind) => {
  preview?.setGridKind(kind, planetGrid)
  refreshFlatMap()
})

/** 复位视角 */
function onResetView() {
  preview?.resetView()
}

// 平面展开 / 量化图

/** 正在显示的图片（戴森球 = 平面展开图；地基 = 16 色量化图） */
const flatMapUrl = ref('')
/** 摊平出来的画布（戴森球） */
let flatMapCanvas: HTMLCanvasElement | null = null
/** 网格线叠加层 */
const gridEl = ref<HTMLCanvasElement | null>(null)
/** 量化图用的画面效果参数（和采样一致，用于判断要不要重算） */
let quantizeToken = 0

/** 重新摊平 / 重新量化 */
function refreshFlatMap() {
  if (!painting.showFlatMap) {
    flatMapUrl.value = ''
    flatMapCanvas = null
    return
  }
  if (isFoundationMode.value) {
    refreshQuantized()
    return
  }
  flatMapCanvas = preview?.exportFlatMap() ?? null
  flatMapUrl.value = flatMapCanvas ? flatMapCanvas.toDataURL('image/png') : ''
  nextTick(refreshGrid)
}

/** 地基: 把图片按当前调色板压成 16 色量化图（只画裁剪窗口那一块，和涂上去的内容一致） */
function refreshQuantized() {
  const palette = foundationResult.value?.palette
  if (!palette?.length || !painting.imageUrl) {
    flatMapUrl.value = ''
    return
  }
  const token = ++quantizeToken
  drawQuantizedImage(painting.imageUrl, palette, {
    brightness: painting.brightness,
    contrast: painting.contrast,
    saturation: painting.saturation,
    sharpness: painting.sharpness,
  }, painting.quantizeMethod, quantizedCropRect.value).then((canvas) => {
    if (token !== quantizeToken) return // 已被更新的请求取代
    flatMapUrl.value = canvas.toDataURL('image/png')
  }).catch((error) => {
    if (token !== quantizeToken) return
    flatMapUrl.value = ''
    toast.show(`量化图生成失败：${(error as Error).message}`)
  })
}

/** 把网格线画到叠加层上 */
function refreshGrid() {
  const el = gridEl.value
  if (!el) return
  if (painting.showFlatMap && painting.showGridLines) preview?.drawFlatMapGrid(el)
  else el.width = 0
}

// 涂色结果或视图切换后重新摊平 / 量化
watch(
  [paintResult, foundationResult, () => painting.showFlatMap, () => painting.imageUrl],
  refreshFlatMap,
  { flush: 'post' },
)
// 画面效果变了，量化图要重算（只在地基模式下需要）
watch(
  () => [
    painting.brightness,
    painting.contrast,
    painting.saturation,
    painting.sharpness,
  ] as const,
  () => {
    if (isFoundationMode.value && painting.showFlatMap) refreshQuantized()
  },
)
watch(() => painting.showGridLines, () => nextTick(refreshGrid))

/** 导出展开图 PNG（只有戴森球的平面展开有导出） */
async function onExportFlatMap() {
  const canvas = flatMapCanvas ?? preview?.exportFlatMap()
  if (!canvas) {
    toast.show('请先生成彩绘')
    return
  }
  try {
    await downloadCanvas(canvas, '平面展开')
  } catch (error) {
    toast.show(`导出失败：${(error as Error).message}`)
  }
}

// 状态栏

/** 状态标签: 投影模式 / 颜色数 / 生成时间（两种生成模式一致） */
const statusChips = computed(() => {
  const chips: Array<{ text: string; warn?: boolean }> = [
    { text: currentMode.value.label },
  ]
  const st = isFoundationMode.value ? foundationStats.value : paintStats.value
  if (st) {
    chips.push({ text: `${st.colorsUsed} 色` })
    chips.push({ text: `${st.totalMs} ms` })
  } else {
    chips.push({ text: generating.value ? '生成中…' : '尚未生成', warn: true })
  }
  return chips
})

/** 当前生成模式有没有出结果（没有就在舞台上盖空态提示；有结果时是透明的，不挡网格） */
const hasPaint = computed(() => (
  isFoundationMode.value ? !!foundationResult.value : !!paintResult.value
))

/** 舞台空态文案 */
const emptyHint = computed(() => (painting.imageUrl ? '正在生成…' : '输入图片开始生成'))
</script>

<template>
  <div class="paint-preview">
    <div class="paint-preview-stage">
      <!-- 3D 画布 -->
      <canvas ref="canvasEl" :class="{ 'is-hidden': painting.showFlatMap }"></canvas>

      <!-- 平面展开（戴森球）/ 16 色量化图（地基: 不导出、不带说明） -->
      <div v-if="painting.showFlatMap" class="paint-flatmap">
        <div v-if="!isFoundationMode" class="paint-flatmap-head">
          <button class="btn-sm btn-ghost" type="button" @click="onExportFlatMap">
            导出展开图
          </button>
        </div>
        <div class="paint-flatmap-body">
          <div v-if="flatMapUrl" class="paint-flatmap-figure" :class="{ 'paint-flatmap-figure--fit': isFoundationMode }">
            <img
              class="paint-flatmap-img"
              :class="{ 'paint-flatmap-img--fit': isFoundationMode }"
              :src="flatMapUrl"
              :alt="isFoundationMode ? '16 色量化图' : '涂色展开图'"
            />
            <canvas v-if="!isFoundationMode" ref="gridEl" class="paint-flatmap-grid"></canvas>
          </div>
          <div v-else class="paint-flatmap-empty">{{ emptyHint }}</div>
        </div>
        <!-- 说明只给平面展开图（量化图不显示） -->
        <div v-if="!isFoundationMode" class="paint-flatmap-hint">沿本初子午线分割</div>
      </div>

      <!-- 3D 预览: 还没出结果就盖一层空态提示（两种生成模式一致；提示是透明的，不挡底下的网格） -->
      <div v-else-if="!hasPaint" class="paint-preview-empty">
        <div>{{ emptyHint }}</div>
      </div>

      <div v-show="!painting.showFlatMap" class="paint-preview-tools">
        <button class="btn-sm" type="button" @click="onResetView">复位视角</button>
      </div>
    </div>

    <div class="paint-preview-status">
      <span
        v-for="(chip, i) in statusChips"
        :key="i"
        class="paint-chip"
        :class="{ 'text-warning': chip.warn }"
      >{{ chip.text }}</span>
      <label class="paint-check paint-grid-toggle">
        <input type="checkbox" v-model="painting.showGridLines" /> 显示网格线
      </label>
    </div>
  </div>
</template>

<style scoped>
.paint-preview {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
  min-height: 0;
}

.paint-preview-stage {
  position: relative;
  flex: 1;
  min-height: 0;
  border-radius: 16px;
  overflow: hidden;
  background: var(--bg-stage-alt);
}

.paint-preview-stage canvas {
  width: 100%;
  height: 100%;
  display: block;
}

/* 被展开图盖住时只是看不见，仍占布局尺寸 */
.paint-preview-stage canvas.is-hidden {
  visibility: hidden;
}

/* 空态提示是透明的，不挡底下的网格 */
.paint-preview-empty {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  pointer-events: none;
  font-size: 13px;
  color: var(--fg-secondary);
  text-align: center;
  padding: 12px;
}

/* 复位视角: 舞台左下角 */
.paint-preview-tools {
  position: absolute;
  left: 10px;
  bottom: 10px;
  display: flex;
  gap: 4px;
  z-index: 2;
}

.paint-preview-status {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  font-size: 11px;
  flex-shrink: 0;
}

.paint-chip {
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--bg-inset);
  border: 1px solid var(--line-inset);
  color: var(--fg-secondary);
  white-space: nowrap;
}

.paint-check {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--fg-secondary);
  cursor: pointer;
  white-space: nowrap;
}

/* 网格线开关: 跟在状态标签后面，用竖线分隔 */
.paint-grid-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: 4px;
  padding-left: 8px;
  border-left: 1px solid var(--line-faint);
  font-size: 11px;
  color: var(--fg-secondary);
  cursor: pointer;
  white-space: nowrap;
}

.paint-flatmap {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  /* 与 3D 预览同一底色 */
  background: var(--bg-stage-alt);
}

/* 仅一个「导出展开图」按钮，靠右 */
.paint-flatmap-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: bold;
  color: var(--fg-secondary);
  flex-shrink: 0;
}

.paint-flatmap-head .btn-sm {
  margin-left: auto;
}

.paint-flatmap-body {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 只显示，不导出 */
.paint-flatmap-figure {
  position: relative;
  display: inline-flex;
  max-width: 100%;
  max-height: 100%;
}

.paint-flatmap-grid {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.paint-flatmap-img {
  max-width: 100%;
  max-height: 100%;
  display: block;
  border-radius: 6px;
  border: 1px solid var(--line-faint);
  image-rendering: pixelated;
}

/* 16 色量化图（地基）: 图框和图片都铺满可视区，位图再按原图比例 contain 在里面。
   不能只给 img 写 max-height: 100% —— 图框高度是 auto 时百分比解不出来，
   竖图 / 方图会按自身尺寸撑高、顶出容器 */
.paint-flatmap-figure--fit {
  width: 100%;
  height: 100%;
}

.paint-flatmap-img--fit {
  image-rendering: auto;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.paint-flatmap-empty {
  font-size: 12px;
  color: var(--fg-muted);
  padding: 12px 0;
  text-align: center;
}

.paint-flatmap-hint {
  font-size: 11px;
  line-height: 1.6;
  color: var(--fg-muted);
  flex-shrink: 0;
}
</style>
