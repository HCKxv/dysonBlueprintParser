<script setup lang="ts">
import StatsPanel from './SpherePanel/StatsPanel.vue'
import PreviewPanel from './SpherePanel/PreviewPanel.vue'
import SettingsPanel from './SpherePanel/SettingsPanel.vue'
import BlueprintInput from './SpherePanel/BlueprintInput.vue'
import CopyShellModal from './SpherePanel/CopyShellModal.vue'
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

  <CopyShellModal />
</template>

<style scoped>
/* 蓝图预览的三栏。窄屏重排要靠本组件的 grid-area / order，所以媒体查询留在这里；
   右栏内部几块在子组件里，选择器必须走 :deep 才带得上作用域 */

.panels {
  grid-template-columns: minmax(250px, 320px) minmax(750px, 1fr) minmax(300px, 380px);
}

.panel-left {
  padding-right: 10px;
}

.panel-center,
.panel-right {
  min-width: 0;
}

.panel-right h2 {
  flex-shrink: 0;
}

/* 两栏: 右栏横跨一整行 */
@media (max-width: 1500px) {
  .panels {
    grid-template-columns: minmax(250px, 1fr) minmax(0, 3fr);
    grid-template-areas:
      "right right"
      "left center";
  }

  .panel-right {
    grid-area: right;
    order: 2;
  }

  .panel-left {
    grid-area: left;
    order: 3;
    min-width: 0;
  }

  .panel-center {
    grid-area: center;
    order: 4;
    min-width: 0;
  }
}

/* 右栏内部再分格: 蓝图输入占右侧通高 */
@media (min-width: 961px) and (max-width: 1500px) {
  .panels {
    grid-template-rows: auto minmax(0, 1fr);
  }

  .panel-right {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 3fr);
    grid-template-rows: auto auto;
    grid-template-areas:
      "power input"
      "settings input";
  }

  .panel-right > :deep(.power-panel) {
    grid-area: power;
    border-bottom: 1px solid var(--line);
    margin: 0;
    padding: 8px 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .panel-right > div:nth-child(2) {
    grid-area: settings;
    min-width: 0;
  }

  .panel-right > :deep(.input-group) {
    grid-area: input;
    border-top: none;
    border-left: 1px solid var(--line);
    padding-left: 12px;
    min-width: 0;
  }

  .panel-right :deep(.power-main) {
    white-space: nowrap;
  }

  .panel-right :deep(textarea) {
    min-height: 60px;
  }
}

/* 单栏 */
@media (max-width: 960px) {
  .panels {
    grid-template-columns: 1fr;
    grid-template-rows: auto auto minmax(0, 1fr);
    grid-template-areas:
      "right"
      "center"
      "left";
  }

  .panel-center {
    order: 3;
    aspect-ratio: 4 / 3;
  }

  .panel-left {
    order: 4;
  }
}
</style>
