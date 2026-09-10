<script setup lang="ts">
import StatsPanel from './StatsPanel/StatsPanel.vue'
import PreviewPanel from './PreviewPanel.vue'
import SettingsPanel from './SettingsPanel.vue'
import BlueprintInput from './BlueprintInput.vue'
</script>

<template>
  <div class="panels">
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
</template>
