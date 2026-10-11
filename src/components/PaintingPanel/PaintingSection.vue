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

<style scoped>
/* 折叠分组（.arrow 见 styles/shared.css）
   注意: 收起态只写在 body 上 —— 顶栏也带 .collapsed（用来转箭头），
   把它做成全局的 .collapsed { display: none } 会把标题栏一起藏掉，卡片就展不开了 */
.paint-section {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--bg-panel);
  overflow: hidden;
  flex-shrink: 0;
}

.paint-section-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 10px;
  font-size: 13px;
  font-weight: bold;
  color: var(--fg-secondary);
  cursor: pointer;
  user-select: none;
}

.paint-section-header:hover {
  background: #16203a;
  color: var(--fg-strong);
}

.paint-section-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.paint-section-extra {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: default;
}

.paint-section-extra .btn-sm {
  font-weight: normal;
}

.paint-section-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px 10px 10px;
  min-width: 0;
}

.paint-section-body.collapsed {
  display: none;
}

/* 让参数面板里的分组直接参与本体排布，分组分隔线才连续 */
.paint-section-body > .paint-projection {
  display: contents;
}
</style>
