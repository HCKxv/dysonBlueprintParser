<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'
import { DysonSpherePreview } from '../lib/preview/preview.js'
import { setPreview } from '../stores/app'

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
</script>

<template>
  <div class="canvas-container">
    <canvas ref="canvasEl"></canvas>
  </div>
</template>
