<script setup lang="ts">
import { ref, watch } from 'vue'
import BaseModal from '../BaseModal.vue'
import {
  factory,
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
  () => factory.showOpenModal,
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
  <BaseModal :open="factory.showOpenModal" title="打开蓝图" @close="onClose">
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
        role="button"
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
