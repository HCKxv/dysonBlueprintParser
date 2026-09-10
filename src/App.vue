<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'
import AppHeader from './components/AppHeader.vue'
import BlueprintParse from './components/BlueprintParse.vue'
import FooterBar from './components/FooterBar.vue'
import AppToast from './components/AppToast.vue'
import CopyShellModal from './components/copyShellModal.vue'
import { loadUrlBlueprint } from './stores/app'

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
    <BlueprintParse />
  </div>

  <FooterBar />
  <CopyShellModal />
  <AppToast />
</template>
