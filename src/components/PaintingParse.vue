<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import ToolSlider from './ToolSlider.vue'
import PaintingSection from './PaintingPanel/PaintingSection.vue'
import PaintingInput from './PaintingPanel/PaintingInput.vue'
import PaintingImage from './PaintingPanel/PaintingImage.vue'
import PaintingMode from './PaintingPanel/PaintingMode.vue'
import PaintingBase from './PaintingPanel/PaintingBase.vue'
import PaintingPreview from './PaintingPanel/PaintingPreview.vue'
import {
  painting,
  PAINT_PARAM_KEYS,
  generatePainting,
  exportPaintingBlueprint,
  resetPaintParams,
  paintParamsDirty,
  paintStats,
  foundationStats,
  isFoundationMode,
} from '../stores/painting'
import { useToast } from '../composables/useToast'
import { saveAsText } from '../utils/download'
import { handleBlueprintText } from '../stores/preview'
import { activeTool } from '../stores/tool'

const toast = useToast()

/** 当前生成模式是否已经有可导出的数据 */
const canExport = computed(() => (
  isFoundationMode.value ? !!foundationStats.value : !!paintStats.value
))

/** 导出提示: 地基模式说明铺了多少格地基（粘贴有科技上限） */
const exportHint = computed(() => {
  if (!isFoundationMode.value) return '导出类型为单层戴森壳，建议以最大半径粘贴'
  const stats = foundationStats.value
  return `使用时需勾选【粘贴地基调色盘设置】，如果地基过多，可以先铺满地基后再拍蓝图；`
})

/** 生成彩绘: 图片 → 涂色网格数据 */
async function onGenerate() {
  if (!painting.imageUrl) return
  try {
    await generatePainting()
  } catch (error) {
    toast.show(`生成彩绘失败：\n${(error as Error).message}`)
  }
}

/** 复制蓝图字符串到剪贴板 */
async function onCopyBlueprint() {
  try {
    const text = await exportPaintingBlueprint()
    await navigator.clipboard.writeText(text)
    toast.show('已复制蓝图到剪贴板')
  } catch (error) {
    toast.show(`复制失败：\n${(error as Error).message}`)
  }
}

/** 下载蓝图: 弹「另存为」对话框选路径（没有那个 API 的浏览器退化成直接下载） */
async function onDownloadBlueprint() {
  try {
    const text = await exportPaintingBlueprint()
    const saved = await saveAsText(text, {
      suggestedName: `${isFoundationMode.value ? '地基彩绘蓝图' : '戴森球彩绘蓝图'}.txt`,
      startIn: 'downloads',
      types: [{ description: '蓝图文件', accept: { 'text/plain': ['.txt'] } }],
    })
    if (saved.error) throw new Error(saved.error)
    if (saved.canceled) return // 取消保存不算失败
    toast.show(saved.handle ? `已保存到 ${saved.handle.name}` : '这个浏览器不能直接写文件，已改为下载')
  } catch (error) {
    toast.show(`下载失败：\n${(error as Error).message}`)
  }
}

/** 在预览工具中查看 */
async function onViewInPreview() {
  try {
    const text = await exportPaintingBlueprint()
    activeTool.value = 'preview'
    handleBlueprintText(text)
  } catch (error) {
    toast.show(`无法在预览中打开：\n${(error as Error).message}`)
  }
}

// ── 图片 / 参数变化后自动重新生成（120ms 防抖） ──
// 参数列表直接用 store 的 PAINT_PARAM_KEYS，新增参数不用回来补这一份
let timer: ReturnType<typeof setTimeout> | undefined

function scheduleGenerate() {
  if (!painting.imageUrl) return
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => { onGenerate() }, 120)
}

watch(
  () => [
    painting.imageUrl,
    painting.paintMode,
    painting.projMode,
    ...PAINT_PARAM_KEYS.map((k) => painting[k]),
  ] as const,
  scheduleGenerate,
)

onBeforeUnmount(() => {
  if (timer) clearTimeout(timer)
})

/** 预览视图 */
const viewItems = computed(() => [
  { value: '3d', label: '3D 预览' },
  { value: 'flat', label: isFoundationMode.value ? '量化图' : '平面展开' },
])

const paintView = computed({
  get: () => (painting.showFlatMap ? 'flat' : '3d'),
  set: (v: string) => { painting.showFlatMap = v === 'flat' },
})

// ── 左栏上下边缘: 超出容器范围的内容做模糊过渡 ──
// 滚到顶/底时对应那一层淡出，避免"明明没内容了还糊着一条"
const scrollEl = ref<HTMLElement | null>(null)
const canScrollUp = ref(false)
const canScrollDown = ref(false)

function updateScrollEdges() {
  const el = scrollEl.value
  if (!el) return
  canScrollUp.value = el.scrollTop > 1
  canScrollDown.value = el.scrollTop < el.scrollHeight - el.clientHeight - 1
}

let edgeObserver: ResizeObserver | null = null

onMounted(() => {
  updateScrollEdges()
  const el = scrollEl.value
  if (!el || typeof ResizeObserver === 'undefined') return
  // 容器尺寸变化、以及各分组折叠/展开导致的内容高度变化，都要重算
  edgeObserver = new ResizeObserver(updateScrollEdges)
  edgeObserver.observe(el)
  for (const child of Array.from(el.children)) edgeObserver.observe(child)
})

onBeforeUnmount(() => {
  edgeObserver?.disconnect()
  edgeObserver = null
})
</script>

<template>
  <div class="panels panels--paint">
    <div class="col paint-col">
      <div ref="scrollEl" class="scroll-y paint-scroll" @scroll="updateScrollEdges">
        <PaintingSection title="图片输入">
          <PaintingInput />
        </PaintingSection>

        <PaintingSection title="模式选择">
          <PaintingMode />
        </PaintingSection>

        <PaintingSection title="参数设置">
          <template #extra>
            <button
              class="btn-sm btn-ghost"
              type="button"
              :disabled="!paintParamsDirty"
              @click="resetPaintParams"
            >恢复默认参数</button>
          </template>
          <PaintingImage />
        </PaintingSection>

        <!-- 基底只对戴森球蓝图有意义；地基的行星网格之后放自己的设置区 -->
        <PaintingSection v-if="!isFoundationMode" title="戴森壳">
          <PaintingBase />
        </PaintingSection>

        <PaintingSection :title="isFoundationMode ? '导出地基蓝图' : '导出戴森球蓝图'">
          <div class="paint-actions">
            <button
              class="btn btn-ghost"
              type="button"
              :disabled="!canExport"
              @click="onCopyBlueprint"
            >复制蓝图</button>
            <button
              class="btn btn-ghost"
              type="button"
              :disabled="!canExport"
              @click="onDownloadBlueprint"
            >保存蓝图</button>
            <button
              v-if="!isFoundationMode"
              class="btn btn-ghost"
              type="button"
              :disabled="!canExport"
              @click="onViewInPreview"
            >查看蓝图</button>
          </div>

          <div class="paint-export-hint">{{ exportHint }}</div>
        </PaintingSection>
      </div>

      <!-- 上下边缘: 滚动时超出容器范围的内容做模糊过渡 -->
      <div class="scroll-edge-blur top" :class="{ show: canScrollUp }"></div>
      <div class="scroll-edge-blur bottom" :class="{ show: canScrollDown }"></div>
    </div>

    <div class="col panel paint-col-preview">
      <div class="paint-view-row">
        <ToolSlider
          v-model="paintView"
          class="paint-view-switch"
          :items="viewItems"
        />
      </div>
      <PaintingPreview />
    </div>
  </div>
</template>

<style scoped>
/* 彩绘工具: 两栏 1 : 2，左栏最小 360px。行数必须固定成一行，否则会命中
   .panels 在 (max-width:1500px) 的 auto minmax(0,1fr)，预览被压扁 */
.panels--paint {
  grid-template-columns: minmax(360px, 1fr) minmax(0, 2fr);
  grid-template-rows: minmax(0, 1fr);
  grid-template-areas: "left center";
  /* 比通用的 12px 少 4px: 左栏内容右侧还给滚动条留了 4px */
  column-gap: 8px;
}

.panels--paint > .paint-col {
  grid-area: left;
}

/* 只占一个区域名，与蓝图预览的 .panel-center 无关 */
.panels--paint > .paint-col-preview {
  grid-area: center;
  min-width: 0;
}

/* 面板本身要当边缘模糊层的定位基准 */
.paint-col {
  overflow: hidden;
  position: relative;
}

.paint-scroll {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-right: 4px;
}

.scroll-edge-blur {
  position: absolute;
  left: 0;
  right: 0;
  height: 30px;
  z-index: 2;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.18s ease;
  backdrop-filter: blur(5px);
  -webkit-backdrop-filter: blur(5px);
}

.scroll-edge-blur.show {
  opacity: 1;
}

.scroll-edge-blur.top {
  top: 0;
  background: linear-gradient(to bottom, rgba(11, 16, 32, 0.7), rgba(11, 16, 32, 0));
  mask-image: linear-gradient(to bottom, #000 0%, rgba(0, 0, 0, 0.45) 55%, transparent 100%);
  -webkit-mask-image: linear-gradient(to bottom, #000 0%, rgba(0, 0, 0, 0.45) 55%, transparent 100%);
}

.scroll-edge-blur.bottom {
  bottom: 0;
  background: linear-gradient(to top, rgba(11, 16, 32, 0.7), rgba(11, 16, 32, 0));
  mask-image: linear-gradient(to top, #000 0%, rgba(0, 0, 0, 0.45) 55%, transparent 100%);
  -webkit-mask-image: linear-gradient(to top, #000 0%, rgba(0, 0, 0, 0.45) 55%, transparent 100%);
}

.paint-view-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
  flex-shrink: 0;
}

/* 两列等宽，50% 宽的滑块才正好对上第二格 */
.paint-view-switch {
  display: inline-grid;
  grid-template-columns: 1fr 1fr;
}

.paint-view-switch :deep(.tool-slider-btn) {
  justify-content: center;
  padding: 3px 12px;
  font-size: 12px;
  gap: 0;
}

.paint-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* 全局 button 是 width: fit-content，这里要撑满整行 */
.paint-actions .btn {
  width: 100%;
  min-width: 0;
}

.paint-export-hint {
  margin-top: 8px;
  font-size: 11px;
  line-height: 1.6;
  color: var(--fg-muted);
}

/* 窄屏（≤960px，与顶栏工具切换同断点）: 预览在上、输入在下 */
@media (max-width: 960px) {
  .panels--paint {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr);
    grid-template-areas:
      "center"
      "left";
  }

  .panels--paint > .paint-col-preview {
    order: 1;
    aspect-ratio: 4 / 3;
  }

  .panels--paint > .paint-col {
    order: 2;
  }
}
</style>
