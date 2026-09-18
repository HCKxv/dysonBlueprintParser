<script setup lang="ts">
import { ref, watch } from 'vue'
import {
  painting,
  importedBase,
  BUILTIN_BASES,
  selectBase,
  importBaseBlueprint,
  clearImportedBase,
} from '../../stores/painting'
import { useToast } from '../../composables/useToast'

const toast = useToast()

/** 输入框上方的提示（单行省略显示，完整内容靠 title） */
const IMPORT_HINT = '注意甄别未知来源的蓝图；建议使用全包裹的壳面，否则会影响最终效果。'

/** 导入区是否展开 */
const importOpen = ref(false)
const importText = ref('')
const importing = ref(false)

/** 导入失败提示：显示在按钮区右边，不走全局 toast */
const importError = ref('')

/** 改动输入内容后旧的报错就不再适用 */
watch(importText, () => {
  importError.value = ''
})

/** 展开/收起输入框 */
function toggleImport() {
  importOpen.value = !importOpen.value
  if (!importOpen.value) importError.value = ''
}

async function applyImport() {
  const text = importText.value.trim()
  if (!text) {
    importError.value = '请先粘贴蓝图内容'
    return
  }
  importing.value = true
  importError.value = ''
  try {
    const res = await importBaseBlueprint(text)
    if (!res.ok) {
      importError.value = res.message
      return
    }
    toast.show(res.message)
    importText.value = ''
    importOpen.value = false
  } finally {
    importing.value = false
  }
}

function onClearImport() {
  clearImportedBase()
  importText.value = ''
  importOpen.value = false
  importError.value = ''
  toast.show('已清除导入的基底')
}
</script>

<template>
  <div class="paint-base">
    <div class="paint-param">
      <div class="base-list">
        <button
          v-for="b in BUILTIN_BASES"
          :key="b.id"
          type="button"
          class="base-item"
          :class="{ active: painting.baseId === b.id }"
          @click="selectBase(b.id)"
        >
          <span class="base-name">{{ b.label }}</span>
          <span class="base-meta">
            {{ b.info.nodes }} 节点 · {{ b.info.frames }} 框架 · {{ b.info.faces }} 壳面
          </span>
        </button>

        <!-- 导入的蓝图 -->
        <button
          v-if="importedBase"
          type="button"
          class="base-item"
          :class="{ active: painting.baseId === 'imported' }"
          @click="selectBase('imported')"
        >
          <span class="base-name" :title="importedBase.label">{{ importedBase.label }}</span>
          <span class="base-meta">
            {{ importedBase.info.nodes }} 节点 · {{ importedBase.info.frames }} 框架 ·
            {{ importedBase.info.faces }} 壳面
          </span>
        </button>

        <!-- 导入入口 -->
        <button
          type="button"
          class="base-item base-import-toggle"
          :class="{ open: importOpen }"
          @click="toggleImport"
        >
          <span class="base-name">
            <span class="base-arrow">▸</span>
            {{ importedBase ? '重新导入蓝图' : '导入蓝图' }}
          </span>
          <span class="base-meta">粘贴蓝图内容，只接受单层戴森壳</span>
        </button>

        <div v-if="importOpen" class="base-import">
          <div class="base-import-hint" :title="IMPORT_HINT">
            {{ IMPORT_HINT }}
          </div>
          <textarea
            v-model="importText"
            class="base-import-input"
            placeholder="粘贴以 DYBP: 开头的单层壳蓝图"
          ></textarea>
          <div class="base-import-actions">
            <button class="btn-sm" type="button" :disabled="importing" @click="applyImport">
              {{ importing ? '导入中…' : '应用' }}
            </button>
            <button
              v-if="importedBase"
              class="btn-sm btn-ghost"
              type="button"
              @click="onClearImport"
            >清除</button>
            <span
              v-if="importError"
              class="base-import-error"
              :title="importError"
              role="alert"
            >{{ importError }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
