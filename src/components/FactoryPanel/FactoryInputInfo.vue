<script setup lang="ts">
import { ref, watch } from 'vue'
import FactoryInfo from './FactoryInfo.vue'
import FactorySelection from './FactorySelection.vue'
import {
  factory,
  hasBlueprint,
  hasChanges,
  openBlueprintModal,
  closeBlueprint,
  copyBlueprint,
  revertBlueprint,
  saveBlueprintFile,
} from '../../stores/factory'
import { useToast } from '../../composables/useToast'

const toast = useToast()

/** 信息 / 详情: 工具栏右边那个滑块切换 */
const view = ref<'info' | 'detail'>('info')

// 选中 / 取消选中时自动切
watch(() => factory.selectedIndex, (index) => {
  view.value = index === null ? 'info' : 'detail'
})

function onClose() {
  if (!hasBlueprint.value) return
  closeBlueprint()
  toast.show('已关闭蓝图')
}

async function onCopy() {
  const res = await copyBlueprint()
  toast.show(res.message)
}

/** 还原修改: 从原始蓝图字符串整份恢复 */
async function onRevert() {
  const res = await revertBlueprint()
  if (res.message) toast.show(res.message)
}

/** 保存到文件 */
async function onSave() {
  const res = await saveBlueprintFile()
  if (res.message) toast.show(res.message) // 取消保存时 message 为空，不弹提示
}
</script>

<template>
  <div class="factory-toolbar">
    <button
      class="btn-sm"
      type="button"
      :disabled="factory.parsing"
      @click="openBlueprintModal()"
    >打开蓝图</button>
    <button
      class="btn-sm btn-ghost"
      type="button"
      :disabled="!hasBlueprint || factory.parsing"
      @click="onClose"
    >关闭蓝图</button>

    <!-- 信息 / 详情 切换滑块 -->
    <div class="tool-slider factory-view-switch" role="tablist" aria-label="信息 / 详情">
      <span
        class="tool-slider-thumb"
        :style="{ transform: `translateX(${view === 'detail' ? 100 : 0}%)` }"
      ></span>
      <button
        type="button"
        role="tab"
        class="tool-slider-btn"
        :class="{ active: view === 'info' }"
        :aria-selected="view === 'info'"
        @click="view = 'info'"
      >信息</button>
      <button
        type="button"
        role="tab"
        class="tool-slider-btn"
        :class="{ active: view === 'detail' }"
        :aria-selected="view === 'detail'"
        @click="view = 'detail'"
      >详情</button>
    </div>
  </div>

  <div class="scroll-y factory-scroll">
    <FactoryInfo v-if="view === 'info'" />
    <FactorySelection v-else />
  </div>

  <!-- 复制/保存/还原 -->
  <div class="factory-footer">
    <button
      class="btn-sm btn-ghost factory-revert"
      type="button"
      :disabled="!hasBlueprint || factory.parsing || !hasChanges"
      @click="onRevert"
    >还原修改</button>
    <button
      class="btn-sm btn-ghost"
      type="button"
      :disabled="!hasBlueprint || factory.parsing"
      @click="onCopy"
    >复制蓝图<template v-if="hasChanges"> *</template></button>
    <button
      class="btn-sm btn-ghost"
      type="button"
      :disabled="!hasBlueprint || factory.parsing || !hasChanges"
      @click="onSave"
    >保存蓝图</button>
  </div>
</template>
