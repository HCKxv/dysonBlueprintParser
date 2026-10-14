<script setup lang="ts">
import { computed, ref } from 'vue'
import { store, parseBlueprint, resetBlueprint, handleBlueprintText } from '../../stores/preview'
import { useToast } from '../../composables/useToast'

const toast = useToast()
const dragging = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

const canReset = computed(() => !!(store.parsed || store.errorMessage))

/** 读取蓝图文件并交给校验解析 */
function readFile(file: File) {
  const reader = new FileReader()
  reader.onload = (ev) => handleBlueprintText(String(ev.target?.result ?? ''))
  reader.onerror = () => toast.show('读取文件失败')
  reader.readAsText(file)
}

/** 打开系统文件选择窗口 */
function pickFile() {
  fileInput.value?.click()
}

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) readFile(file)
  // 清空以便连续选择同一个文件时仍能触发 change
  input.value = ''
}

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
    readFile(file)
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
      <div class="btn-actions">
        <div class="btn-group parse-actions">
          <button
            class="btn-sm"
            :disabled="store.parsing"
            @click="parseBlueprint()"
          >解析蓝图</button>
          <button
            class="btn-sm"
            :disabled="!canReset || store.parsing"
            @click="resetBlueprint()"
          >清空结果</button>
        </div>
        <div class="btn-group io-actions">
          <button class="btn-sm" @click="pickFile">文件</button>
          <button class="btn-sm" @click="onPaste">粘贴</button>
          <button class="btn-sm" @click="onCopy">复制</button>
        </div>
      </div>
    </div>
    <input
      ref="fileInput"
      class="hidden"
      type="file"
      accept=".txt,text/plain"
      @change="onFileChange"
    />
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

<style scoped>
.input-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
  min-height: 0;
  border-top: 1px solid var(--line);
}

.input-header {
  display: flex;
  align-items: center;
  /* 标题与按钮容器放不下时换行 */
  flex-wrap: wrap;
  gap: 4px 8px;
  font-size: 13px;
  color: var(--fg-secondary);
  flex-shrink: 0;
  padding: 8px 12px 0 12px;
}

.input-header span {
  font-size: 1.0rem;
  font-weight: bold;
  color: var(--fg);
  /* 变窄时先压缩标题，按钮宽度保持不变 */
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.input-header .btn-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  flex: 1 1 auto;
  min-width: 0;
}

/* shared.css 的 .btn-group 带 margin-left: auto，会把第一组往右推，这里清掉 */
.input-header .btn-group {
  margin: 0;
}

/* 第一组保持自身宽度 */
.input-header .parse-actions {
  flex: 0 0 auto;
}

.input-header .io-actions {
  flex: 1 1 auto;
  min-width: 0;
  justify-content: flex-end;
}

.input-header .btn-sm {
  padding: 4px 10px;
  border-radius: 8px;
  font-size: 12px;
  /* 按钮内部文字保持单行，避免按钮被压窄后文字竖排 */
  white-space: nowrap;
}

.textarea-wrapper {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
}

.textarea-wrapper textarea.drag-over {
  border-color: var(--accent);
  box-shadow: 0 0 12px var(--accent-ring);
}

.textarea-wrapper .drop-hint {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  pointer-events: none;
  font-size: 16px;
  font-weight: bold;
  color: var(--fg-strong);
  opacity: 0;
  transition: opacity 0.2s;
  text-align: center;
  background: rgba(16, 22, 36, 0.88);
  padding: 16px 28px;
  border-radius: 12px;
  border: 2px dashed var(--accent);
  white-space: nowrap;
}

.textarea-wrapper .drop-hint.show {
  opacity: 1;
}
</style>
