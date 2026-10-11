<script setup lang="ts">
import { computed } from 'vue'

/** 一档: value 是身份（选中值就是它），label 是默认文字 */
export interface SliderItem {
  value: string
  label: string
}

/**
 * 滑动指示块的档位切换（顶栏工具 / 彩绘视图 / 工厂信息-详情-批量编辑 共用）。
 * 尺寸与位置由外面的 class 给；要图标就用 #item 槽覆盖默认的 label。
 */
const props = defineProps<{
  /** 档位表，顺序就是显示顺序 */
  items: SliderItem[]
  modelValue: string
}>()

const emit = defineEmits<{ 'update:modelValue': [string] }>()

/** 值不在表里时给 -1，指示块就不显示 */
const activeIndex = computed(() => props.items.findIndex((item) => item.value === props.modelValue))

const sliderStyle = computed(() => ({ '--tool-count': String(Math.max(1, props.items.length)) }))

const thumbStyle = computed(() => ({ transform: `translateX(${Math.max(0, activeIndex.value) * 100}%)` }))
</script>

<template>
  <div class="tool-slider" :style="sliderStyle">
    <span v-if="activeIndex >= 0" class="tool-slider-thumb" :style="thumbStyle"></span>
    <button
      v-for="(item, i) in items"
      :key="item.value"
      type="button"
      class="tool-slider-btn"
      :class="{ active: item.value === modelValue }"
      @click="emit('update:modelValue', item.value)"
    >
      <slot name="item" :item="item" :index="i">{{ item.label }}</slot>
    </button>
  </div>
</template>

<style scoped>
.tool-slider {
  position: relative;
  display: inline-flex;
  align-items: center;
  padding: 2px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--bg-app);
  gap: 0;
  flex-shrink: 0;
  min-width: 0;
}

.tool-slider-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  /* 由本组件按档位数注入，缺省 2 档 */
  width: calc(100% / var(--tool-count, 2) - 4px / var(--tool-count, 2));
  height: calc(100% - 4px);
  border-radius: 8px;
  background: linear-gradient(180deg, #4364eb, #3451c9);
  box-shadow: 0 2px 10px var(--accent-glow);
  transition: transform 0.28s cubic-bezier(0.4, 0.9, 0.3, 1);
  pointer-events: none;
}

.tool-slider-btn {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 14px;
  border-radius: 8px;
  background: transparent;
  color: var(--fg-icon);
  font-size: 13px;
  font-weight: 500;
  line-height: 1.5;
  white-space: nowrap;
  transition: color 0.25s ease;
}

.tool-slider-btn:hover {
  background: transparent;
  color: var(--fg);
}

.tool-slider-btn.active,
.tool-slider-btn.active:hover {
  background: transparent;
  color: #fff;
  font-weight: bold;
}
</style>
