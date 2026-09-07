<script setup lang="ts">
import { store } from '../../stores/app'
import StatSection from './StatSection.vue'
import StatBox from './StatBox.vue'
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
          <StatBox v-else :node="node" />
        </template>
      </template>
    </div>
  </div>
</template>
