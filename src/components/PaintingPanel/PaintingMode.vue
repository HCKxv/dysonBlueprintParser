<script setup lang="ts">
import {
  painting,
  PAINT_MODES,
  availableProjModes,
} from '../../stores/painting'

// 模式选择: 生成模式（戴森球蓝图 / 地基蓝图）+ 投影模式
// 投影模式列表跟着生成模式走
</script>

<template>
  <div class="paint-projection">
    <!-- ── 生成模式 ── -->
    <div class="paint-params-block">
      <div class="paint-params-head"><span>生成模式</span></div>
      <div class="mode-grid">
        <button
          v-for="m in PAINT_MODES"
          :key="m.value"
          type="button"
          class="mode-card"
          :class="{ active: painting.paintMode === m.value }"
          @click="painting.paintMode = m.value"
        >
          <span class="mode-icon" v-html="m.icon"></span>
          <span class="mode-label">{{ m.label }}</span>
          <span class="mode-desc">{{ m.desc }}</span>
        </button>
      </div>
    </div>

    <!-- ── 投影模式 ── -->
    <div class="paint-params-block">
      <div class="paint-params-head"><span>投影模式</span></div>
      <div class="mode-grid">
        <button
          v-for="m in availableProjModes"
          :key="m.value"
          type="button"
          class="mode-card"
          :class="{ active: painting.projMode === m.value }"
          @click="painting.projMode = m.value"
        >
          <span class="mode-icon" v-html="m.icon"></span>
          <span class="mode-label">{{ m.label }}</span>
          <span class="mode-desc">{{ m.desc }}</span>
        </button>
      </div>
    </div>
  </div>
</template>
