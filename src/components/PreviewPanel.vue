<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'
import { DysonSpherePreview } from '../lib/preview/preview.js'
import { setPreview } from '../stores/app'
import { useToast } from '../composables/useToast'

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

// 导出文件名时间戳（YYYYMMDD-HHmmss）
function timestamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  )
}

// 导出当前预览画面为 PNG 并触发下载
function onExportImage() {
  if (!preview) {
    toast.show('预览尚未初始化')
    return
  }
  const out = preview.exportImage(2)
  if (!out) {
    toast.show('导出失败：无法生成图片')
    return
  }
  out.toBlob((blob) => {
    if (!blob) {
      toast.show('导出失败：无法生成图片')
      return
    }
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `戴森球蓝图预览-${timestamp()}.png`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    toast.show('已导出图片')
  }, 'image/png')
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
