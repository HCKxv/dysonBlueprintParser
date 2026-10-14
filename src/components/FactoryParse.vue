<script setup lang="ts">
import FactoryInputInfo from './FactoryPanel/FactoryInputInfo.vue'
import FactoryPreview from './FactoryPanel/FactoryPreview.vue'
import OpenBlueprintModal from './FactoryPanel/OpenBlueprintModal.vue'
</script>

<template>
  <div class="panels panels--factory">
    <div class="col panel factory-col-input">
      <FactoryInputInfo />
    </div>
    <div class="col panel factory-col-preview">
      <FactoryPreview />
    </div>
  </div>

  <OpenBlueprintModal />
</template>

<style scoped>
/* 工厂工具: 左「蓝图预览」右「蓝图输入和信息」。行数必须固定成一行，
   否则命中 .panels 在 (max-width:1500px) 的 auto minmax(0,1fr) */
.panels--factory {
  grid-template-columns: minmax(0, 1fr) minmax(380px, 520px);
  grid-template-rows: minmax(0, 1fr);
  grid-template-areas: "center left";
}

.panels--factory > .factory-col-input {
  grid-area: left;
  min-height: 0;
}

.panels--factory > .factory-col-preview {
  grid-area: center;
  min-width: 0;
  min-height: 0;
}

/* 窄屏: 预览在上、输入栏在下 */
@media (max-width: 960px) {
  .panels--factory {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr);
    grid-template-areas:
      "center"
      "left";
  }

  .panels--factory > .factory-col-preview {
    order: 1;
    height: 60vh;
  }

  /* 舞台本来有 240px 底（见 FactoryPreview.vue）: 视口很矮时它会顶破 60vh 被裁掉 */
  .panels--factory > .factory-col-preview :deep(.factory-preview-stage) {
    min-height: 0;
  }
}
</style>
