<script setup lang="ts">
/** 传送带的参数 */
import { computed, ref } from 'vue'
import { itemIconUrl } from '../../lib/markup/itemIcons'
import type { IconCategories, IconRef } from '../../lib/markup/itemIcons'
import { itemName } from '../../lib/blueprint/factory/factoryItems.js'
import IconPickerModal from './IconPickerModal.vue'

const props = defineProps<{
  /** 这栋建筑的参数对象 */
  parameters: Record<string, any>
  /** 可选的图标 */
  itemIcons: IconCategories
}>()

const emit = defineEmits<{
  /** 改了一项参数（iconId / count） */
  change: [key: string, value: unknown]
}>()

/** 图标标签的物品 id（0 = 没标签） */
const iconId = computed(() => Number(props.parameters?.iconId ?? 0))
/** 图标标签上的数字 */
const count = computed(() => Number(props.parameters?.count ?? 0))
const MIN_COUNT = 0
const MAX_COUNT = 999999

/** 标签浮层（贴着图标格显示） */
const picker = ref(false)
const anchor = ref<HTMLElement | null>(null)

function openPicker(e: MouseEvent) {
  anchor.value = e.currentTarget as HTMLElement
  picker.value = true
}

function onPick(icon: IconRef) {
  emit('change', 'iconId', Number(icon.id))
}

/** 右键图标 = 清除标签（数字跟着图标走，一并归零） */
function onClear() {
  if (iconId.value <= 0) return
  emit('change', 'iconId', 0)
  emit('change', 'count', 0)
}

/** 数字: 取整并钳在 0~999999；空着或敲了非法内容就当 0 */
function onCount(e: Event) {
  const el = e.target as HTMLInputElement
  const typed = Number(el.value)
  const value = Math.min(MAX_COUNT, Math.max(MIN_COUNT, Math.round(Number.isFinite(typed) ? typed : MIN_COUNT)))
  el.value = String(value)
  emit('change', 'count', value)
}</script>

<template>
  <div class="factory-selection-params">
    <div class="factory-selection-row factory-selection-param">
      <span class="factory-selection-label">图标标签</span>
      <button
        class="factory-belt-icon"
        type="button"
        :title="iconId > 0 ? '右键清除' : '选择物品'"
        @click="openPicker"
        @contextmenu.prevent="onClear"
      >
        <img v-if="iconId > 0" class="factory-icon" :src="itemIconUrl(iconId)" :alt="itemName(iconId)" />
        <span v-else class="factory-belt-empty">+</span>
      </button>
      <input
        v-if="iconId > 0"
        class="factory-belt-count"
        type="number"
        :min="MIN_COUNT"
        :max="MAX_COUNT"
        step="1"
        :value="count"
        @change="onCount"
      />
    </div>

    <IconPickerModal
      :open="picker"
      :categories="itemIcons"
      default-category="物品"
      :current="iconId"
      :anchor="anchor"
      title="图标标签"
      @select="onPick"
      @close="picker = false"
    />
  </div>
</template>

<style scoped>
/* .factory-selection-* 那套参数行是共用件（在 styles/shared.css 里）：
   它们挂在父组件 FactorySelection 的模板结构下，写成本组件的 scoped 会失效 */

.factory-belt-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border-radius: 4px;
  border: 1px solid var(--line-strong);
  background: var(--bg-slot);
  color: #6f8ec0;
  cursor: pointer;
}

.factory-belt-icon:hover {
  border-color: var(--accent);
}

.factory-belt-icon .factory-icon {
  width: 80%;
  height: 80%;
}

.factory-belt-empty {
  font-size: 16px;
  line-height: 1;
}

.factory-belt-count {
  width: 92px;
  padding: 1px 4px;
  border-radius: 4px;
  border: 1px solid var(--line-strong);
  background: var(--bg-slot);
  color: var(--fg-value);
  font-family: inherit;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}

.factory-belt-count:focus {
  outline: none;
  border-color: var(--accent);
}
</style>
