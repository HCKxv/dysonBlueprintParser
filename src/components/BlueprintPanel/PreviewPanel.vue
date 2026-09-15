<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'
import { DysonSpherePreview } from '../../lib/preview/preview.js'
import { downloadCanvas } from '../../utils/download'
import { setPreview } from '../../stores/preview'
import { useToast } from '../../composables/useToast'

const toast = useToast()
const canvasEl = ref<HTMLCanvasElement | null>(null)
let preview: DysonSpherePreview | null = null

onMounted(() => {
  if (!canvasEl.value) return
  preview = new DysonSpherePreview()
  preview.init(canvasEl.value)
  setPreview(preview)
})

onBeforeUnmount(() => {
  setPreview(null)
  preview?.dispose()
  preview = null
})

// 导出当前预览画面为 PNG 并触发下载
async function onExportImage() {
  if (!preview) {
    toast.show('预览尚未初始化')
    return
  }
  const out = preview.exportImage(2)
  if (!out) {
    toast.show('导出失败：无法生成图片')
    return
  }
  try {
    await downloadCanvas(out, '戴森球预览图')
    toast.show('已导出图片')
  } catch (error) {
    toast.show(`导出失败：${(error as Error).message}`)
  }
}
</script>

<template>
  <div class="canvas-container">
    <canvas ref="canvasEl"></canvas>
    <button
      class="export-btn btn-sm"
      type="button"
      title="导出当前预览为 PNG 图片"
      @click="onExportImage"
    >导出图片</button>
  </div>
</template>
