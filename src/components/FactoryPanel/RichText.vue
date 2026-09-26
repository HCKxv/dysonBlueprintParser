<script setup lang="ts">
import { onBeforeUpdate, onMounted, ref } from 'vue'
import { mountRichText, projectRichText } from '../../lib/markup/richTextDom'
import { itemIconUrl } from '../../lib/markup/itemIcons'

/**
 * 富文本的只读渲染: 和编辑框共用同一套显示层，所以两处显示只可能一样
 *
 * 没有输入、没有状态，只有"文本变了就重投影"这一个方向，也不需要 v-html。
 */
const props = defineProps<{
  /** 原始文本（带 \tag; 标记） */
  text: string
}>()

const el = ref<HTMLElement | null>(null)

/** 重投影（能就地更新的就地更新，没动的地方节点不重建） */
function paint() {
  const node = el.value
  if (!node) return
  mountRichText(node, projectRichText(props.text ?? '', { resolveIcon: itemIconUrl }))
}

onMounted(paint)
// 用组件更新的必经之路跟文本对账（理由同编辑框: 不靠 watcher 的调度顺序）
onBeforeUpdate(paint)
</script>

<template>
  <!-- 内容由投影填，模板里留空 —— Vue 不碰它的子节点 -->
  <div ref="el" class="rich-text-view"></div>
</template>
