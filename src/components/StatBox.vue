<script setup lang="ts">
import type { StatNode } from '../lib/statsTree'

defineProps<{ node: StatNode }>()

function onToggle(node: StatNode, e: Event) {
  const checked = (e.target as HTMLInputElement).checked
  node.toggle?.onChange(checked)
}
</script>

<template>
  <div class="stat-box">
    <!-- 标题行 -->
    <div class="stat-title-row">
      <span class="stat-title">
        <input
          v-if="node.toggle"
          type="checkbox"
          class="stat-checkbox"
          :checked="node.toggle.checked"
          @change="onToggle(node, $event)"
        />
        <strong>{{ node.label }}</strong>
      </span>
      <button
        v-if="node.button"
        type="button"
        class="btn-sm stat-card-btn"
        :title="node.button.title"
        @click="node.button.onClick()"
      >
        {{ node.button.label }}
      </button>
    </div>
    <div class="stat-value" v-html="node.value"></div>
  </div>
</template>
