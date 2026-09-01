<script setup lang="ts">
import { ref } from 'vue'
import { setLayerVisible } from '../stores/app'
import type { StatNode } from '../lib/statsTree'

defineProps<{ node: StatNode }>()

// 分组默认折叠
const collapsed = ref(true)

function onToggle(node: StatNode, e: Event) {
  const checked = (e.target as HTMLInputElement).checked
  setLayerVisible(node.layerType as 'shell' | 'cloud', node.id as number, checked)
}
</script>

<template>
  <div class="stat-section">
    <div class="stat-section-header" :class="{ collapsed }" @click="collapsed = !collapsed">
      <span class="arrow">▼</span> {{ node.title }} ({{ node.count }})
    </div>
    <div class="stat-section-body" :class="{ collapsed }">
      <template v-for="(child, i) in node.children" :key="i">
        <StatSection v-if="child.kind === 'section'" :node="child" />
        <div v-else class="stat-box">
          <input
            v-if="child.kind === 'toggle'"
            type="checkbox"
            class="stat-checkbox"
            :checked="child.checked"
            @change="onToggle(child, $event)"
          />
          <span><strong>{{ child.label }}</strong><br /><span v-html="child.value"></span></span>
        </div>
      </template>
    </div>
  </div>
</template>
