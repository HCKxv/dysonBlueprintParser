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

<style scoped>
/* 收起态只能写在 body 上 —— 标题栏也带 .collapsed（用来转箭头），
   做成全局的 .collapsed{display:none} 会把标题栏一起藏掉 */
.stat-section {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.stat-section-header {
  padding: 6px 12px;
  background: var(--bg-inset);
  border: 1px solid var(--line-inset);
  border-radius: 8px;
  font-size: 13px;
  font-weight: bold;
  cursor: pointer;
  user-select: none;
  display: flex;
  align-items: center;
  gap: 6px;
}

.stat-section-header:hover {
  background: #162032;
}

.stat-section-title {
  min-width: 0;
}

.stat-section-body {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.stat-section-body.collapsed {
  display: none;
}
</style>
