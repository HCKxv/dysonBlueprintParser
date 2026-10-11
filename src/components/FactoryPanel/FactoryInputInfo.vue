<script setup lang="ts">
import FactoryInfo from './FactoryInfo.vue'
import FactorySelection from './FactorySelection.vue'
import FactoryBatchEdit from './FactoryBatchEdit.vue'
import ToolSlider from '../ToolSlider.vue'
import {
  factory,
  factoryView,
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

/** 三档的图标在模板里，这里只要 value 与 label */
const viewItems = [
  { value: 'info', label: '信息' },
  { value: 'detail', label: '详情' },
  { value: 'batch', label: '批量编辑' },
]

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
    <ToolSlider
      v-model="factoryView"
      class="factory-view-switch"
      :items="viewItems"
    >
      <template #item="{ item }">
        <!-- 信息 -->
        <svg v-if="item.value === 'info'" viewBox="0 0 16 16">
          <rect x="3" y="2.2" width="10" height="11.6" rx="1.6" />
          <path d="M5.6 5.4h4.8" />
          <path d="M5.6 8h4.8" />
          <path d="M5.6 10.6h3.1" />
        </svg>
        <!-- 详情 -->
        <svg v-else-if="item.value === 'detail'" viewBox="0 0 16 16">
          <circle cx="6.9" cy="6.9" r="4.35" />
          <path d="M10.1 10.1 13.45 13.45" />
        </svg>
        <!-- 批量编辑 -->
        <svg v-else viewBox="0 0 16 16">
          <path d="M10.16 3.94A4.6 4.6 0 0 1 9.94 12.17" />
          <path d="M5.84 12.06A4.6 4.6 0 0 1 6.06 3.83" />
          <polygon points="10.79 10.9 8.72 12.54 11.19 13.47" />
          <polygon points="5.21 5.1 7.28 3.46 4.81 2.53" />
        </svg>
      </template>
    </ToolSlider>
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

<style scoped>
.factory-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--line);
  flex-shrink: 0;
}

.factory-scroll {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* 底部操作条: 不跟着内容滚走 */
.factory-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end; /* 复制 / 保存靠右 */
  gap: 8px;
  padding-top: 10px;
  border-top: 1px solid var(--line);
  flex-shrink: 0;
}

.factory-revert {
  margin-right: auto;
}

/* 三档滑块（滑动件本身见 components/ToolSlider.vue） */
.factory-view-switch {
  display: inline-grid;
  grid-template-columns: repeat(3, 1fr);
  margin-left: auto;
}

.factory-view-switch :deep(.tool-slider-btn) {
  justify-content: center;
  padding: 3px 8px; /* 三档都是图标，左右内边距压到 8px，图标间距 16px */
  min-height: 24px; /* 文字换成图标后别被压矮，滑块高度跟旁边按钮对齐 */
  font-size: 12px;
  gap: 0;
}

/* 信息 = 文件 / 详情 = 放大镜 / 批量编辑 = 循环双箭头，线性图标跟着档位文字色走 */
.factory-view-switch :deep(svg) {
  width: 14px;
  height: 14px;
  display: block;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.3;
  stroke-linecap: round;
  stroke-linejoin: round;
}

/* 批量编辑档的两个箭头是实心三角 */
.factory-view-switch :deep(svg polygon) {
  fill: currentColor;
  stroke: none;
}
</style>
