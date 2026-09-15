<script setup lang="ts">
import { ref, watch } from 'vue'
import { painting, loadImageFile, clearImage, clearPainting } from '../../stores/painting'
import { useToast } from '../../composables/useToast'

const toast = useToast()

const dragging = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

function openPicker() {
  fileInput.value?.click()
}

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) pickFile(file)
  input.value = '' // 允许重复选择同一文件
}

function pickFile(file: File) {
  const res = loadImageFile(file)
  if (!res.ok) {
    toast.show(res.message)
    return
  }
  toast.show('已载入图片')
}

// 图片变化后旧涂色数据不再对应当前图片，先清掉
watch(() => painting.imageUrl, () => clearPainting())

function onDragOver(e: DragEvent) {
  e.preventDefault()
  e.stopPropagation()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  dragging.value = true
}

function onDragLeave(e: DragEvent) {
  e.preventDefault()
  e.stopPropagation()
  const el = e.currentTarget as HTMLElement
  if (!el.contains(e.relatedTarget as Node | null)) dragging.value = false
}

function onDrop(e: DragEvent) {
  e.preventDefault()
  e.stopPropagation()
  dragging.value = false
  const file = e.dataTransfer?.files?.[0]
  if (!file) {
    toast.show('未检测到图片文件')
    return
  }
  pickFile(file)
}

function onClear() {
  clearImage()
  clearPainting()
  toast.show('已清除图片')
}
</script>

<template>
  <div class="paint-input">
    <input
      ref="fileInput"
      class="hidden"
      type="file"
      accept="image/*"
      @change="onFileChange"
    />

    <div
      class="image-drop"
      :class="{ 'drag-over': dragging, 'has-image': !!painting.imageUrl }"
      role="button"
      tabindex="0"
      @click="openPicker"
      @keydown.enter.prevent="openPicker"
      @keydown.space.prevent="openPicker"
      @dragover="onDragOver"
      @dragenter="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
    >
      <template v-if="painting.imageLoading">
        <div class="image-drop-hint">读取图片中…</div>
      </template>

      <template v-else-if="painting.imageUrl">
        <img class="image-thumb" :src="painting.imageUrl" alt="输入图片预览" />
        <div class="image-meta">
          <span class="image-name" :title="painting.imageName">{{ painting.imageName }}</span>
          <span class="image-dim">{{ painting.imageWidth }} × {{ painting.imageHeight }}</span>
        </div>
        <div class="image-overlay">点击更换图片</div>
      </template>

      <template v-else>
        <div class="image-drop-hint">点击选择图片，或拖放到此处</div>
        <div class="image-drop-sub">支持 PNG / JPG / WebP</div>
      </template>

      <div class="drop-hint" :class="{ show: dragging }">📂 释放图片以载入</div>
    </div>

    <div class="paint-row">
      <button class="btn-sm" type="button" @click="openPicker">选择图片</button>
      <button class="btn-sm btn-ghost" type="button" :disabled="!painting.imageUrl" @click="onClear">清除图片</button>
      <span class="paint-tip">或拖放图片到上方</span>
    </div>
  </div>
</template>
