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
