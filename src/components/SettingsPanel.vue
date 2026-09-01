<script setup lang="ts">
import {
  store,
  onRadiusChange,
  onLuminosityChange,
  refreshPower,
  setGridVisible,
  setRotationEnabled,
  setRotationSpeed,
} from '../stores/app'

function onSpeedChange(e: Event) {
  setRotationSpeed(parseFloat((e.target as HTMLSelectElement).value) || 0.05)
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
      <div class="menu">
        <span v-show="store.isSingleShell">半径</span>
        <input
          v-show="store.isSingleShell"
          type="number"
          v-model.number="store.radius"
          step="100"
          min="4000"
          class="input-dark w-80"
          @change="onRadiusChange"
        />
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
      <div class="menu">
        <span>发电量计算:</span>
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
      <div class="menu">
        显示:
        <label>
          <input type="checkbox" v-model="store.gridVisible" @change="setGridVisible(store.gridVisible)" /> 刻度
        </label>
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
</template>
