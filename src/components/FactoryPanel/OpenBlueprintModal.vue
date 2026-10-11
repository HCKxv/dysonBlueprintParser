<script setup lang="ts">
import { ref, watch } from 'vue'
import BaseModal from '../BaseModal.vue'
import {
  showOpenModal,
  closeBlueprintModal,
  loadBlueprintFile,
  loadBlueprintText,
} from '../../stores/factory'
import { useToast } from '../../composables/useToast'

const toast = useToast()

const text = ref('')
const error = ref('')
const busy = ref(false)
const dragging = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

watch(
  showOpenModal,
  (open) => {
    if (!open) return
    text.value = ''
    error.value = ''
    busy.value = false
    dragging.value = false
  },
)

async function pickFile() {
  if (busy.value) return
  // 优先用 File System Access API: 只有它能拿到文件句柄（「保存蓝图」要写回原路径）
  const pickOpen = (window as any).showOpenFilePicker
  if (typeof pickOpen !== 'function') {
    fileInput.value?.click()
    return
  }
  try {
    const [handle] = await pickOpen({
      multiple: false,
      types: [{ description: '工厂蓝图', accept: { 'text/plain': ['.txt'] } }],
    })
    await importWith(() => loadBlueprintFile(handle))
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') return // 用户取消
    error.value = `打开文件失败：${(error as Error).message}`
  }
}

async function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // 允许重复选择同一文件
  if (file) await importWith(() => loadBlueprintFile(file))
}

/** 三条导入路径共用的收尾: 置忙、导入、报错或关窗 */
async function importWith(load: () => Promise<{ ok: boolean, message: string }>) {
  busy.value = true
  error.value = ''
  const res = await load()
  busy.value = false
  if (!res.ok) {
    error.value = res.message
    return
  }
  toast.show(res.message)
  closeBlueprintModal()
}

async function onImportText() {
  const value = text.value.trim()
  if (!value || busy.value) return
  await importWith(() => loadBlueprintText(value))
}

function onDragOver(e: DragEvent) {
  e.preventDefault()
  e.stopPropagation()
  if (busy.value) return
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  dragging.value = true
}

function onDragLeave(e: DragEvent) {
  e.preventDefault()
  e.stopPropagation()
  const el = e.currentTarget as HTMLElement
  if (!el.contains(e.relatedTarget as Node | null)) dragging.value = false
}

async function onDrop(e: DragEvent) {
  e.preventDefault()
  e.stopPropagation()
  dragging.value = false
  if (busy.value) return
  const file = e.dataTransfer?.files?.[0]
  if (!file) {
    error.value = '未检测到蓝图文件'
    return
  }
  // 拖进来的文件也能拿到句柄（Chromium）: 必须在事件还活着的时候发起
  const getHandle = (e.dataTransfer?.items?.[0] as any)?.getAsFileSystemHandle
  let handle: FileSystemFileHandle | null = null
  if (typeof getHandle === 'function') {
    try {
      const picked = await getHandle.call(e.dataTransfer!.items[0])
      handle = picked?.kind === 'file' ? picked : null
    } catch {
      handle = null
    }
  }
  await importWith(() => loadBlueprintFile(handle ?? file))
}

function onClose() {
  if (busy.value) return
  closeBlueprintModal()
}
</script>

<template>
  <BaseModal :open="showOpenModal" title="打开蓝图" @close="onClose">
    <div class="factory-import">
      <input
        ref="fileInput"
        class="hidden"
        type="file"
        accept=".txt,text/plain"
        @change="onFileChange"
      />

      <div
        class="factory-import-drop"
        :class="{ 'drag-over': dragging }"
        tabindex="0"
        @click="pickFile"
        @keydown.enter.prevent="pickFile"
        @keydown.space.prevent="pickFile"
        @dragover="onDragOver"
        @dragenter="onDragOver"
        @dragleave="onDragLeave"
        @drop="onDrop"
      >
        <div class="factory-import-drop-title">点击选择蓝图文件</div>
        <div class="factory-import-drop-sub">或把 .txt 蓝图文件拖放到此处</div>
        <div class="drop-hint" :class="{ show: dragging }">📂 释放文件以打开蓝图</div>
      </div>

      <div class="factory-import-or"><span>或粘贴蓝图代码</span></div>

      <textarea
        v-model="text"
        class="factory-import-text"
        placeholder="BLUEPRINT:..."
        spellcheck="false"
      ></textarea>

      <div v-if="error" class="factory-import-error">{{ error }}</div>

      <div class="btn-group center">
        <button
          class="btn-sm"
          type="button"
          :disabled="busy || !text.trim()"
          @click="onImportText"
        >{{ busy ? '解析中…' : '导入' }}</button>
        <button class="btn-sm btn-ghost" type="button" :disabled="busy" @click="onClose">取消</button>
      </div>
    </div>
  </BaseModal>
</template>

<style scoped>
.factory-import {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.factory-import-drop {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 32px 12px;
  border-radius: 10px;
  border: 1px dashed #34506f;
  background: var(--bg-input);
  text-align: center;
  cursor: pointer;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.factory-import-drop:hover {
  border-color: var(--accent);
}

.factory-import-drop.drag-over {
  border-color: var(--accent);
  box-shadow: 0 0 12px var(--accent-ring);
}

.factory-import-drop-title {
  font-size: 13px;
  color: var(--fg-strong);
}

.factory-import-drop-sub {
  font-size: 11px;
  color: var(--fg-muted);
}

.factory-import-drop .drop-hint {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  pointer-events: none;
  font-size: 13px;
  font-weight: bold;
  color: var(--fg-strong);
  opacity: 0;
  transition: opacity 0.2s;
  text-align: center;
  background: rgba(16, 22, 36, 0.9);
  padding: 10px 16px;
  border-radius: 10px;
  border: 2px dashed var(--accent);
  white-space: nowrap;
}

.factory-import-drop .drop-hint.show {
  opacity: 1;
}

/* 「或」分隔线 */
.factory-import-or {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--fg-muted);
  white-space: nowrap;
}

.factory-import-or::before,
.factory-import-or::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--line);
}

.factory-import-text {
  width: 100%;
  min-height: 90px;
  max-height: 180px;
  box-sizing: border-box;
  padding: 10px;
  border-radius: 10px;
  border: 1px solid var(--line-soft);
  background: var(--bg-input);
  color: var(--fg-strong);
  font-size: 12px;
  line-height: 1.5;
  resize: vertical;
}

.factory-import-error {
  font-size: 12px;
  line-height: 1.5;
  color: var(--danger);
  word-break: break-all;
}
</style>
