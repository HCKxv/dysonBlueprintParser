<script setup lang="ts">
import { store, setLayerVisible } from '../stores/app'
import StatSection from './StatSection.vue'
import type { StatNode } from '../lib/statsTree'

function onToggle(node: StatNode, e: Event) {
  const checked = (e.target as HTMLInputElement).checked
  setLayerVisible(node.layerType as 'shell' | 'cloud', node.id as number, checked)
}
</script>

<template>
  <div class="scroll-y">
    <div class="stat-grid">
      <!-- 解析失败 -->
      <div v-if="store.errorMessage" class="stat-box">
        <strong>❌ 解析失败</strong><br />
        {{ store.errorMessage }}
      </div>

      <!-- 未解析 -->
      <div v-else-if="store.statsTree.length === 0" class="stat-box">
        请输入蓝图字符串并点击解析
      </div>

      <!-- 信息节点树 -->
      <template v-else>
        <template v-for="(node, i) in store.statsTree" :key="i">
          <StatSection v-if="node.kind === 'section'" :node="node" />
          <div v-else class="stat-box">
            <input
              v-if="node.kind === 'toggle'"
              type="checkbox"
              class="stat-checkbox"
              :checked="node.checked"
              @change="onToggle(node, $event)"
            />
            <span><strong>{{ node.label }}</strong><br /><span v-html="node.value"></span></span>
          </div>
        </template>
      </template>
    </div>
  </div>
</template>
