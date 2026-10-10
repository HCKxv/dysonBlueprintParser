<script setup lang="ts">
import { computed } from 'vue'
import FactoryInfo from './FactoryInfo.vue'
import FactorySelection from './FactorySelection.vue'
import FactoryBatchEdit from './FactoryBatchEdit.vue'
import {
  factory,
  FACTORY_VIEWS,
  factoryView,
  setFactoryView,
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

/** 指示块按档位序号平移 */
const sliderIndex = computed(() => FACTORY_VIEWS.indexOf(factoryView.value))

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

    <!-- 三档滑块: 信息 / 详情 / 批量编辑 -->
    <div class="tool-slider factory-view-switch">
      <span
        class="tool-slider-thumb"
        :style="{ transform: `translateX(${sliderIndex * 100}%)` }"
      ></span>
      <!-- 信息 -->
      <button
        type="button"
        class="tool-slider-btn"
        :class="{ active: factoryView === 'info' }"
        @click="setFactoryView('info')"
      >
        <svg viewBox="0 0 16 16">
          <rect x="3" y="2.2" width="10" height="11.6" rx="1.6" />
          <path d="M5.6 5.4h4.8" />
          <path d="M5.6 8h4.8" />
          <path d="M5.6 10.6h3.1" />
        </svg>
      </button>
      <!-- 详情 -->
      <button
        type="button"
        class="tool-slider-btn"
        :class="{ active: factoryView === 'detail' }"
        @click="setFactoryView('detail')"
      >
        <svg viewBox="0 0 16 16">
          <circle cx="6.9" cy="6.9" r="4.35" />
          <path d="M10.1 10.1 13.45 13.45" />
        </svg>
      </button>
      <!-- 批量编辑 -->
      <button
        type="button"
        class="tool-slider-btn"
        :class="{ active: factoryView === 'batch' }"
        @click="setFactoryView('batch')"
      >
        <svg viewBox="0 0 16 16">
          <path d="M10.16 3.94A4.6 4.6 0 0 1 9.94 12.17" />
          <path d="M5.84 12.06A4.6 4.6 0 0 1 6.06 3.83" />
          <polygon points="10.79 10.9 8.72 12.54 11.19 13.47" />
          <polygon points="5.21 5.1 7.28 3.46 4.81 2.53" />
        </svg>
      </button>
    </div>
  </div>

  <div class="scroll-y factory-scroll">
    <FactoryBatchEdit v-if="factoryView === 'batch'" />
    <FactoryInfo v-else-if="factoryView === 'info'" />
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
