<script setup lang="ts">
import {
  store,
  onRadiusChange,
  onLuminosityChange,
  refreshPower,
  setGridVisible,
  setRotationEnabled,
  setRotationSpeed,
  setBackground,
  setQuality,
} from '../../stores/preview'

function onSpeedChange(e: Event) {
  setRotationSpeed(parseFloat((e.target as HTMLSelectElement).value) || 0.05)
}

function onBackgroundChange(e: Event) {
  const v = (e.target as HTMLSelectElement).value
  setBackground(v === 'star' ? 'star' : 'plain')
}

function onQualityChange(e: Event) {
  const v = (e.target as HTMLSelectElement).value
  setQuality(v === 'low' ? 'low' : 'high')
}
</script>

<template>
  <!-- 发电量 -->
  <div class="power-panel">
    <div class="power-main">⚡ <span>{{ store.powerText }}</span></div>
  </div>

  <!-- 设置菜单 -->
  <div>
    <div
      class="menu-header"
      :class="{ collapsed: store.menuCollapsed }"
      @click="store.menuCollapsed = !store.menuCollapsed"
    >
      <span class="arrow">▼</span>设置
    </div>
    <div class="menu-div" :class="{ collapsed: store.menuCollapsed }">
      <form novalidate><div class="menu">
        <div v-show="store.showRadiusInput" class="menu">
          <span>半径</span>
          <input
            type="number"
            v-model.number="store.radius"
            step="1000"
            min="4000"
            max="300000"
            class="input-dark w-80"
            @change="onRadiusChange"
          />
        </div>
        <div class="menu">
          光度系数
          <input
            type="number"
            v-model.number="store.luminosity"
            step="0.1"
            min="0.1"
            class="input-dark w-70"
            @change="onLuminosityChange"
          />
        </div>
      </div></form>
      <div class="menu">
        <span>发电量计算:</span>
        <div class="menu">
          <label>
            <input type="checkbox" v-model="store.isNode" @change="refreshPower" /> 节点
          </label>
          <label>
            <input type="checkbox" v-model="store.isFrame" @change="refreshPower" /> 框架
          </label>
          <label>
            <input type="checkbox" v-model="store.isFaces" @change="refreshPower" /> 壳面
          </label>
        </div>
      </div>
      <div class="menu">
        显示:
        <div class="menu">
          <div class="menu">画质
            <select class="speed-select" :value="store.quality" @change="onQualityChange">
              <option value="low">低</option>
              <option value="high">高</option>
            </select>
          </div>
          <div class="menu">背景
            <select class="speed-select" :value="store.background" @change="onBackgroundChange">
              <option value="plain">纯色</option>
              <option value="star">星空</option>
            </select>
          </div>
          <label>
            <input type="checkbox" v-model="store.gridVisible" @change="setGridVisible(store.gridVisible)" /> 刻度
          </label>
          <div class="menu">
            <label>
              <input type="checkbox" v-model="store.rotateEnabled" @change="setRotationEnabled(store.rotateEnabled)" /> 旋转
            </label>
            <select class="speed-select" :value="String(store.speed)" @change="onSpeedChange">
              <option value="0.01">慢</option>
              <option value="0.05">中</option>
              <option value="0.2">快</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.power-panel {
  text-align: center;
  padding: 12px 0;
  border-bottom: 1px solid var(--line);
  margin-bottom: 8px;
}

.power-main {
  font-size: 2.2rem;
  font-weight: 700;
  color: var(--warn);
  line-height: 1.2;
}

.menu-header {
  padding: 6px 0;
  color: var(--fg-secondary);
  font-size: 13px;
  font-weight: bold;
  cursor: pointer;
  user-select: none;
  display: flex;
  align-items: center;
  gap: 6px;
  width: fit-content;
}

.menu-header:hover {
  color: var(--fg-strong);
}

.menu-div {
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* 顶栏那个 .collapsed 只用来转箭头，别把标题栏也藏了 */
.menu-div.collapsed {
  display: none;
}
</style>
