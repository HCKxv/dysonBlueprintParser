<script setup lang="ts">
import { ref } from 'vue'
import StatBox from './StatBox.vue'
import type { StatNode } from './statsTree'

defineProps<{ node: StatNode }>()

// 分组默认折叠
const collapsed = ref(true)
</script>

<template>
  <div class="stat-section">
    <div class="stat-section-header" :class="{ collapsed }" @click="collapsed = !collapsed">
      <span class="arrow">▼</span>
      <span class="stat-section-title">{{ node.title }} ({{ node.count }})</span>
      <button
        v-if="node.button"
        type="button"
        class="btn-sm stat-card-btn"
        :title="node.button.title"
        @click.stop="node.button.onClick()"
      >
        {{ node.button.label }}
      </button>
    </div>
    <div class="stat-section-body" :class="{ collapsed }">
      <template v-for="(child, i) in node.children" :key="i">
        <StatSection v-if="child.kind === 'section'" :node="child" />
        <StatBox v-else :node="child" />
      </template>
    </div>
  </div>
</template>
