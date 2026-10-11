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

<style scoped>
.mode-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(104px, 1fr));
  width: 100%;
  gap: 8px;
}

.mode-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 7px 8px;
  border-radius: 9px;
  border: 1px solid var(--line);
  background: var(--bg-panel);
  color: var(--fg-secondary);
  text-align: left;
  /* 全局 button 是 width: fit-content，这里要撑满格子 */
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  transition: border-color 0.2s, background 0.2s;
}

.mode-card:hover {
  background: #16203a;
  border-color: #34506f;
}

.mode-card.active {
  background: #16233c;
  border-color: var(--accent);
  color: var(--fg-strong);
  box-shadow: inset 0 0 0 1px rgba(67, 100, 235, 0.35);
}

/* 内联 SVG，用 currentColor 跟随卡片文字色 */
.mode-icon {
  font-size: 15px;
  line-height: 1.1;
  display: inline-flex;
  width: 15px;
  height: 15px;
}

.mode-icon svg {
  width: 100%;
  height: 100%;
  display: block;
}

.mode-label {
  font-size: 12px;
  font-weight: bold;
}

/* 小字介绍: 超出即省略，不换行（别让小字把卡片撑高） */
.mode-desc {
  font-size: 10px;
  line-height: 1.4;
  color: var(--fg-muted);
  display: block;
  align-self: stretch;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
