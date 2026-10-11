<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue'
import AppHeader from './components/AppHeader.vue'
import BlueprintParse from './components/BlueprintParse.vue'
import PaintingParse from './components/PaintingParse.vue'
import FactoryParse from './components/FactoryParse.vue'
import FooterBar from './components/FooterBar.vue'
import AppToast from './components/AppToast.vue'
import CopyShellModal from './components/BlueprintPanel/CopyShellModal.vue'
import { store, parseBlueprint } from './stores/preview'
import { activeTool } from './stores/tool'
import { clearTxtParamFromUrl, loadBlueprintFromUrl } from './utils/urlLoader'
import { useToast } from './composables/useToast'
import { enableUrlLoad, showFooter } from './config/app'

const toast = useToast()

/** URL 参数加载（?txt=...） */
function loadUrlBlueprint() {
  // 关闭时也要清掉 ?txt=，否则参数会留在地址栏
  if (!enableUrlLoad) {
    clearTxtParamFromUrl()
    return
  }
  loadBlueprintFromUrl({
    onLoadStart: () => toast.show('正在加载蓝图'),
    onLoaded: (text) => {
      activeTool.value = 'preview'
      store.input = text
      parseBlueprint()
    },
    onError: (e) => toast.show(`加载蓝图失败：\n${e.message}`),
  })
}

// 全局拖放拦截 / 中键自动滚动阻止
function onGlobalDragOver(e: DragEvent) {
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'none'
}
function onGlobalDrop(e: DragEvent) {
  e.preventDefault()
}
function onMouseDown(e: MouseEvent) {
  if (e.button === 1) e.preventDefault()
}

onMounted(() => {
  window.addEventListener('dragover', onGlobalDragOver)
  window.addEventListener('drop', onGlobalDrop)
  document.addEventListener('mousedown', onMouseDown)

  // URL 参数加载（?txt=...）
  loadUrlBlueprint()
})

onBeforeUnmount(() => {
  window.removeEventListener('dragover', onGlobalDragOver)
  window.removeEventListener('drop', onGlobalDrop)
  document.removeEventListener('mousedown', onMouseDown)
})
</script>

<template>
  <div class="app">
    <AppHeader />
    <BlueprintParse v-if="activeTool === 'preview'" />
    <PaintingParse v-else-if="activeTool === 'paint'" />
    <FactoryParse v-else />
  </div>

  <FooterBar v-if="showFooter" />
  <CopyShellModal />
  <AppToast />
</template>
