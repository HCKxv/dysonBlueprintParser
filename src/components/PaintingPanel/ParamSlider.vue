<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  modelValue: number
  min?: number
  max?: number
  step?: number
  unit?: string
  /** 有挡位时：滑块只能停在这些取值上 */
  stops?: number[]
}>(), {
  min: 0,
  max: 100,
  step: 1,
  unit: '',
})

const emit = defineEmits<{ 'update:modelValue': [number] }>()

/** 挡位表 */
const stopList = computed(() => (props.stops && props.stops.length > 1 ? props.stops : null))

/** 就近吸附到挡位 */
function snap(v: number): number {
  const list = stopList.value
  if (!list) return Math.min(props.max, Math.max(props.min, v))
  let best = list[0]
  let bestD = Infinity
  for (const s of list) {
    const d = Math.abs(s - v)
    if (d < bestD) { bestD = d; best = s }
  }
  return best
}

const value = computed({
  get: () => props.modelValue,
  set: (v: number) => emit('update:modelValue', Number.isFinite(v) ? snap(v) : props.modelValue),
})

function onNumber(e: Event) {
  const raw = Number((e.target as HTMLInputElement).value)
  if (Number.isFinite(raw)) value.value = raw
}

/** 当前值所在挡位的下标 */
const stopIndex = computed(() => {
  const list = stopList.value
  if (!list) return props.modelValue
  let best = 0
  let bestD = Infinity
  list.forEach((s, i) => {
    const d = Math.abs(s - props.modelValue)
    if (d < bestD) { bestD = d; best = i }
  })
  return best
})

/** 滑块位置（0-100） */
const percent = computed(() => {
  const list = stopList.value
  if (list) return (stopIndex.value / (list.length - 1)) * 100
  const span = props.max - props.min
  if (span <= 0) return 0
  return ((props.modelValue - props.min) / span) * 100
})

/** 当前挡位的显示文本 */
const stopText = computed(() => {
  const list = stopList.value
  if (!list) return ''
  const v = list[stopIndex.value]
  if (v === 0) return '不限制'
  return props.unit ? `${v} ${props.unit}` : `${v}`
})

function onRange(v: number) {
  const list = stopList.value
  if (list) {
    const i = Math.min(list.length - 1, Math.max(0, Math.round(v)))
    emit('update:modelValue', list[i])
    return
  }
  value.value = v
}
</script>

<template>
  <div class="paint-param">
    <div class="paint-param-head">
      <span class="paint-param-label"><slot name="label" /></span>
      <!-- 有挡位: 右侧只显示当前挡位的值，输入交给下面的滑块 -->
      <span v-if="stopList" class="paint-param-value mono">{{ stopText }}</span>
      <span v-else class="paint-param-value">
        <input
          class="input-dark paint-num"
          type="number"
          :min="min"
          :max="max"
          :step="step"
          :value="modelValue"
          @change="onNumber"
        />
        <span v-if="unit" class="paint-unit">{{ unit }}</span>
      </span>
    </div>
    <input
      class="paint-range"
      type="range"
      :min="stopList ? 0 : min"
      :max="stopList ? stopList.length - 1 : max"
      :step="stopList ? 1 : step"
      :value="stopList ? stopIndex : modelValue"
      :style="{ '--paint-range-fill': `${percent}%` }"
      @input="onRange(Number(($event.target as HTMLInputElement).value))"
    />
    <div v-if="stopList" class="paint-range-ticks" aria-hidden="true">
      <span
        v-for="(s, i) in stopList"
        :key="s"
        class="paint-range-tick"
        :class="{ active: i <= stopIndex }"
        :style="{ left: `calc(6px + (100% - 12px) * ${i / (stopList.length - 1)})` }"
      ></span>
    </div>
  </div>
</template>
