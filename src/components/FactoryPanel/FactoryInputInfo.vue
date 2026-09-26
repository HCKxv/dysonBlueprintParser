<script setup lang="ts">
import FactoryInfo from './FactoryInfo.vue'
import {
  factory,
  hasBlueprint,
  metaDirty,
  openBlueprintModal,
  closeBlueprint,
  copyBlueprint,
  saveBlueprintFile,
} from '../../stores/factory'
import { useToast } from '../../composables/useToast'

const toast = useToast()

function onClose() {
  if (!hasBlueprint.value) return
  closeBlueprint()
  toast.show('已关闭蓝图')
}

async function onCopy() {
  const res = await copyBlueprint()
  toast.show(res.message)
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
  </div>

  <div class="scroll-y factory-scroll">
    <FactoryInfo />
  </div>

  <!-- 复制/保存是这一栏最后要做的事，放到底部不跟着内容滚走 -->
  <div class="factory-footer">
    <button
      class="btn-sm btn-ghost"
      type="button"
      :disabled="!hasBlueprint || factory.parsing"
      @click="onCopy"
    >复制蓝图<template v-if="metaDirty"> *</template></button>
    <button
      class="btn-sm btn-ghost"
      type="button"
      :disabled="!hasBlueprint || factory.parsing || !metaDirty"
      @click="onSave"
    >保存蓝图</button>
  </div>
</template>
