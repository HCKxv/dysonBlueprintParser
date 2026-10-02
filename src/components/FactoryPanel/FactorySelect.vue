<script setup lang="ts">
/**
 * 自绘下拉（原生 select 的选项不能自由上色，尤其是选中项的底色）
 *
 * 触发器是个按钮（按当前值换色），点开弹出一列选项；点外面 / Esc / 选完都会关掉。
 * 浮层 fixed 定位，不会把面板撑开。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps<{
  modelValue: number
  /** 值 → 显示名 */
  options: Record<string | number, string>
  /** 触发器文字的前缀（「本地」/「星际」） */
  prefix?: string
  /** 值 → 颜色，决定触发器与各选项的配色 */
  colors?: Record<number, string>
}>()

const emit = defineEmits<{ 'update:modelValue': [number] }>()

/** 浮层位置（fixed，视口坐标） */
const at = ref({ left: 0, top: 0 })
const open = ref(false)
const root = ref<HTMLElement | null>(null)
const box = ref<HTMLElement | null>(null)

const list = computed(() => Object.entries(props.options).map(([value, name]) => ({ value: Number(value), name })))
const currentText = computed(() => `${props.prefix ?? ''}${props.options[props.modelValue] ?? ''}`)

const colorOf = (value: number) => props.colors?.[Number(value)] ?? 'inherit'

/** 贴着触发器算位置: 下面 4px 起，放不下就往上弹（挂载后再按真实高度校正一次） */
function place() {
  const anchor = root.value
  if (!anchor) return
  const rect = anchor.getBoundingClientRect()
  const margin = 8
  const height = box.value?.offsetHeight ?? list.value.length * 20 + 8
  const width = box.value?.offsetWidth ?? 0
  const below = rect.bottom + 4
  at.value = {
    left: Math.round(Math.min(rect.left, Math.max(margin, window.innerWidth - width - margin))),
    top: Math.round(below + height + margin <= window.innerHeight ? below : Math.max(margin, rect.top - 4 - height)),
  }
}

function toggle() {
  if (open.value) {
    open.value = false
    return
  }
  place()            // 先定位再显示，免得闪一下
  open.value = true
  nextTick(place)    // 这时才量得到真实高度
}

function pick(value: number) {
  open.value = false
  if (value !== props.modelValue) emit('update:modelValue', value)
}

function onDocPointer(e: MouseEvent) {
  if (root.value?.contains(e.target as Node) || box.value?.contains(e.target as Node)) return
  open.value = false
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') open.value = false
}

/** 开着的时候才挂这些全局监听 */
function bind(on: boolean) {
  const toggle = on ? 'addEventListener' : 'removeEventListener'
  document[toggle]('mousedown', onDocPointer)
  window[toggle]('keydown', onKeydown)
  window[toggle]('resize', place)
  window[toggle]('scroll', place, true)
}

watch(open, (value) => bind(value))
onBeforeUnmount(() => bind(false))
</script>

<template>
  <span ref="root" class="factory-select">
    <button
      class="factory-select-trigger"
      type="button"
      :style="{ '--role-color': colorOf(modelValue) }"
      @click="toggle"
    >{{ currentText }}</button>

    <Teleport to="body">
      <div
        v-if="open"
        ref="box"
        class="factory-select-pop"
        :style="{ left: `${at.left}px`, top: `${at.top}px` }"
      >
        <button
          v-for="item in list"
          :key="item.value"
          class="factory-select-option"
          :class="{ active: item.value === modelValue }"
          :style="{ '--role-color': colorOf(item.value) }"
          type="button"
          @click="pick(item.value)"
        >{{ prefix }}{{ item.name }}</button>
      </div>
    </Teleport>
  </span>
</template>
