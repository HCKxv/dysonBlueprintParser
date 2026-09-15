<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { PaintingPreview } from '../../lib/painting/PaintingPreview.js'
import {
  painting,
  currentMode,
  paintResult,
  paintStats,
  generating,
} from '../../stores/painting'
import { downloadCanvas } from '../../utils/download'
import { useToast } from '../../composables/useToast'

const toast = useToast()
const canvasEl = ref<HTMLCanvasElement | null>(null)

// 3D 预览

let preview: PaintingPreview | null = null

onMounted(() => {
  if (!canvasEl.value) return
  preview = new PaintingPreview()
  preview.init(canvasEl.value)
  preview.setGridVisible(painting.showGridLines)
  preview.setPainting(paintResult.value)
  preview.setCenterLongitude(painting.hemiLng)
  refreshFlatMap()
})

onBeforeUnmount(() => {
  preview?.dispose()
  preview = null
})

// store 变化 → 同步给预览
watch(paintResult, (fg) => preview?.setPainting(fg))
watch(() => painting.showGridLines, (v) => preview?.setGridVisible(v))
// 经度偏移（半球投影的中心经线）变了，默认视角跟着转
watch(() => painting.hemiLng, (v) => preview?.setCenterLongitude(v))

/** 复位视角 */
function onResetView() {
  preview?.resetView()
}

// 平面展开

/** 正在显示的图片 */
const flatMapUrl = ref('')
/** 摊平出来的画布 */
let flatMapCanvas: HTMLCanvasElement | null = null
/** 网格线叠加层 */
const gridEl = ref<HTMLCanvasElement | null>(null)

/** 重新摊平 */
function refreshFlatMap() {
  if (!painting.showFlatMap) {
    flatMapUrl.value = ''
    flatMapCanvas = null
    return
  }
  flatMapCanvas = preview?.exportFlatMap() ?? null
  flatMapUrl.value = flatMapCanvas ? flatMapCanvas.toDataURL('image/png') : ''
  nextTick(refreshGrid)
}

/** 把网格线画到叠加层上 */
function refreshGrid() {
  const el = gridEl.value
  if (!el) return
  if (painting.showFlatMap && painting.showGridLines) preview?.drawFlatMapGrid(el)
  else el.width = 0
}

// 涂色结果或视图切换后重新摊平
watch(
  [paintResult, () => painting.showFlatMap],
  refreshFlatMap,
  { flush: 'post' },
)
watch(() => painting.showGridLines, () => nextTick(refreshGrid))

/** 导出展开图 PNG */
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

/** 状态标签 */
const statusChips = computed(() => {
  const chips: Array<{ text: string; warn?: boolean }> = [
    { text: currentMode.value.label },
  ]
  const st = paintStats.value
  if (st) {
    chips.push({ text: `${st.colorsUsed} 色` })
    chips.push({ text: `${st.totalMs} ms` })
  } else {
    chips.push({ text: generating.value ? '生成中…' : '尚未生成', warn: true })
  }
  return chips
})
</script>

<template>
  <div class="paint-preview">
    <div class="paint-preview-stage">
      <!-- 3D 画布 -->
      <canvas ref="canvasEl" :class="{ 'is-hidden': painting.showFlatMap }"></canvas>

      <!-- 平面展开 -->
      <div v-if="painting.showFlatMap" class="paint-flatmap">
        <div class="paint-flatmap-head">
          <button class="btn-sm btn-ghost" type="button" @click="onExportFlatMap">导出展开图</button>
        </div>
        <div class="paint-flatmap-body">
          <div v-if="flatMapUrl" class="paint-flatmap-figure">
            <img class="paint-flatmap-img" :src="flatMapUrl" alt="涂色展开图" />
            <canvas ref="gridEl" class="paint-flatmap-grid"></canvas>
          </div>
          <div v-else class="paint-flatmap-empty">输入图片开始生成</div>
        </div>
        <div class="paint-flatmap-hint">
          沿本初子午线分割
        </div>
      </div>

      <div v-else-if="!paintResult" class="paint-preview-empty">
        <div>{{ painting.imageUrl ? '正在生成…' : '输入图片开始生成' }}</div>
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
