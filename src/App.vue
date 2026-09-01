<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'
import AppHeader from './components/AppHeader.vue'
import StatsPanel from './components/StatsPanel.vue'
import PreviewPanel from './components/PreviewPanel.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import BlueprintInput from './components/BlueprintInput.vue'
import FooterBar from './components/FooterBar.vue'
import ChangelogModal from './components/ChangelogModal.vue'
import AppToast from './components/AppToast.vue'
import { loadUrlBlueprint } from './stores/app'

const changelogModal = ref<InstanceType<typeof ChangelogModal> | null>(null)

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
    <div class="col panel panel-left">
      <h2>蓝图信息</h2>
      <StatsPanel />
    </div>
    <div class="col panel panel-center">
      <h2>蓝图预览</h2>
      <PreviewPanel />
    </div>
    <div class="col panel panel-right">
      <SettingsPanel />
      <BlueprintInput />
    </div>
  </div>

  <FooterBar @open-changelog="changelogModal?.open()" />
  <ChangelogModal ref="changelogModal" />
  <AppToast />
</template>
