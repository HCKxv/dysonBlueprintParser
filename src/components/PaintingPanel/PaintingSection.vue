<script setup lang="ts">
import { ref } from 'vue'

defineProps<{ title: string }>()

// 默认展开
const collapsed = ref(false)
</script>

<template>
  <div class="paint-section">
    <div class="paint-section-header" :class="{ collapsed }" @click="collapsed = !collapsed">
      <span class="arrow">▼</span>
      <span class="paint-section-title">{{ title }}</span>
      <!-- 卡片级操作: 放在标题栏右侧，点击不触发折叠 -->
      <span v-if="$slots.extra" class="paint-section-extra" @click.stop>
        <slot name="extra" />
      </span>
    </div>
    <div class="paint-section-body" :class="{ collapsed }">
      <slot />
    </div>
  </div>
</template>
