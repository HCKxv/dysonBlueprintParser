<script setup lang="ts">
import { ref } from 'vue'
import { store, parseBlueprint, handleBlueprintText } from '../stores/app'
import { useToast } from '../composables/useToast'

const toast = useToast()
const dragging = ref(false)

async function onPaste() {
  try {
    store.input = await navigator.clipboard.readText()
  } catch {
    toast.show('无法读取剪贴板，请手动粘贴')
  }
}

async function onCopy() {
  const text = store.input.trim()
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    toast.show('成功复制到剪贴板')
  } catch {
    toast.show('无法复制到剪贴板')
  }
}

function onDragOver(e: DragEvent) {
  e.preventDefault()
  e.stopPropagation()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  dragging.value = true
}

function onDragLeave(e: DragEvent) {
  e.preventDefault()
  e.stopPropagation()
  // 仅在真正离开 wrapper 时移除样式
  const el = e.currentTarget as HTMLElement
  if (!el.contains(e.relatedTarget as Node | null)) {
    dragging.value = false
  }
}

function onDrop(e: DragEvent) {
  e.preventDefault()
  e.stopPropagation()
  dragging.value = false

  const dt = e.dataTransfer
  if (!dt) return

  const file = dt.files && dt.files[0]
  if (file) {
    const reader = new FileReader()
    reader.onload = (ev) => handleBlueprintText(String(ev.target?.result ?? ''))
    reader.onerror = () => toast.show('读取文件失败')
    reader.readAsText(file)
    return
  }

  const text = dt.getData('text/plain')
  if (!text) {
    toast.show('未检测到文件或文本')
    return
  }
  handleBlueprintText(text)
}
</script>

<template>
  <div class="input-group">
    <div class="input-header">
      <span>蓝图输入</span>
      <div class="btn-group">
        <button class="btn-sm" :disabled="store.parsing" @click="parseBlueprint()">解析并预览</button>
        <button class="btn-sm" @click="onPaste">粘贴</button>
        <button class="btn-sm" @click="onCopy">复制</button>
      </div>
    </div>
    <div
      class="textarea-wrapper"
      @dragover="onDragOver"
      @dragenter="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
    >
      <textarea
        v-model="store.input"
        :class="{ 'drag-over': dragging }"
        placeholder="粘贴以 DYBP: 开头的蓝图字符串&#10;或拖动蓝图文件到此处"
      ></textarea>
      <div class="drop-hint" :class="{ show: dragging }">📂 释放文件以加载蓝图</div>
    </div>
  </div>
</template>
