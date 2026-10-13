<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
import { RECIPE_DATA } from '../../lib/blueprint/factory/factoryRecipes.js'
import { itemIconUrl } from '../../lib/markup/itemIcons'

/**
 * 配方提示: 一排图标「产物 ← 原料」（产物在左），个数大于 1 的带数量角标
 *
 * 只认配方 id；显隐看 visible，位置贴着 anchor 自己算。挂 body 上（调用方的容器多半会裁）。
 */
const props = defineProps<{
  /** 配方 id（0 / 查不到就不画） */
  recipeId: number
  /** 显示 / 收起 */
  visible: boolean
  /** 贴着哪个元素画 */
  anchor: HTMLElement | null
}>()

/** 提示里的一格 */
interface TipSlot {
  id: number
  url: string
  count: number
}

/** 配方表里的一项 → 提示里的一格 */
function slotOf(one: { id?: number, count?: number }): TipSlot {
  const id = Number(one?.id) || 0
  return { id, url: itemIconUrl(id), count: Number(one?.count) || 1 }
}

/** 配方流向；查不到给 null（整块不画） */
const flow = computed(() => {
  const data = RECIPE_DATA[Number(props.recipeId) || 0]
  if (!data) return null
  return {
    name: data.name || `#${props.recipeId}`,
    // 配方耗时按游戏 tick 存（60 tick = 1 秒）
    seconds: Math.round((Number(data.time) || 0) / 60 * 10) / 10,
    out: (data.out as { id?: number, count?: number }[]).map(slotOf),
    input: (data.in as { id?: number, count?: number }[]).map(slotOf),
  }
})

const box = useTemplateRef<HTMLElement>('box')
/** 摆好的位置（视口坐标） */
const pos = ref<Record<string, string>>({ left: '0px', top: '0px', visibility: 'hidden' })

/** 贴着锚点底边中点往下画；放不下就整块平移（尺寸不变），左右夹进视口 */
function place() {
  const node = box.value
  const anchor = props.anchor
  if (!node || !anchor) return

  const rect = anchor.getBoundingClientRect()
  const size = node.getBoundingClientRect()
  const margin = 8
  const gap = 8
  const left = Math.max(margin, Math.min(rect.left + rect.width / 2 - size.width / 2, window.innerWidth - size.width - margin))
  let top = rect.bottom + gap
  if (top + size.height > window.innerHeight - margin) top = rect.top - gap - size.height
  top = Math.max(margin, Math.min(top, window.innerHeight - size.height - margin))
  pos.value = { left: `${Math.round(left)}px`, top: `${Math.round(top)}px`, visibility: 'visible' }
}

/**
 * 显示 / 换配方 / 换锚点时量一次再摆。
 * 别改挂 onUpdated: 摆位会改 pos，pos 又参与渲染，更新钩子里改自己的依赖会一直互相触发。
 */
watch(
  () => [props.visible, props.recipeId, props.anchor],
  async () => {
    pos.value = { ...pos.value, visibility: 'hidden' } // 等量准了再显示，免得带着上次的位置闪一帧
    if (!props.visible) return
    await nextTick()
    place()
  },
  { immediate: true },
)
</script>

<template>
  <div v-if="visible && flow" ref="box" class="recipe-tip" :style="pos">
    <span class="recipe-tip-name">{{ flow.name }}</span>
    <div class="recipe-tip-flow">
      <span v-for="(product, i) in flow.out" :key="`out-${i}`" class="recipe-tip-cell">
        <img v-if="product.url" class="factory-icon" :src="product.url" :alt="`产物 ${product.id}`" />
        <span v-if="product.count > 1" class="recipe-tip-count">{{ product.count }}</span>
      </span>
      <span class="recipe-tip-arrow">
        <span class="recipe-tip-second">{{ flow.seconds }}</span>
        <svg viewBox="0 0 14 12" width="14" height="12" aria-hidden="true">
          <path d="M1.5 6h11.5" />
          <path d="M5.5 2.2 1.3 6l4.2 3.8" />
        </svg>
      </span>
      <span v-for="(material, i) in flow.input" :key="`in-${i}`" class="recipe-tip-cell">
        <img v-if="material.url" class="factory-icon" :src="material.url" :alt="`原料 ${material.id}`" />
        <span v-if="material.count > 1" class="recipe-tip-count">{{ material.count }}</span>
      </span>
    </div>
  </div>
</template>

<style scoped>
/* 只用来读；挡住鼠标的话会「盖住格子 → 鼠标离开 → 提示消失」地抖 */
.recipe-tip {
  position: fixed;
  z-index: 130;
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: center;
  padding: 6px 8px;
  border: 1px solid var(--line-strong);
  border-radius: 8px;
  background: var(--bg-pop);
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.55);
  pointer-events: none;
  /* 尺寸只跟内容走；有宽度约束的话贴边时会被挤得换行 */
  width: max-content;
  max-width: none;
}

.recipe-tip-name {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: bold;
  color: var(--fg-strong);
}

/* 一排图标不换行 */
.recipe-tip-flow {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  justify-content: center;
  gap: 4px;
}

/* 一格图标: 角标压在右下角，所以要定位上下文 */
.recipe-tip-cell {
  position: relative;
  flex: 0 0 auto;
  width: 30px;
  height: 30px;
  padding: 2px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--bg-inset);
}

/* 箭头由原料指向产物，秒数标在它上方 */
.recipe-tip-arrow {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
}

.recipe-tip-arrow svg {
  fill: none;
  stroke: var(--fg-muted);
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.recipe-tip-second {
  font-size: 9px;
  line-height: 1;
  color: var(--fg-value);
}

/* 数量角标: 个数大于 1 才画，压在图标右下角 */
.recipe-tip-count {
  position: absolute;
  right: 0;
  bottom: -2px;
  padding: 0 2px;
  font-size: 10px;
  font-weight: bold;
  line-height: 1.2;
  color: #6ea8ff;
  text-shadow: 0 0 3px #000, 0 1px 2px #000;
}
</style>
