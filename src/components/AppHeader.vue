<script setup lang="ts">
import { computed } from 'vue'
import pkg from '../../package.json'
import ToolSlider from './ToolSlider.vue'
import { TOOLS, activeTool } from '../stores/tool'

const version = pkg.version.split('.').slice(0, 2).join('.')

const name = "氢碳钾xv"
const logo =
  'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0idXRmLTgiPz4NCjxzdmcgdmVyc2lvbj0iMS4xIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHg9IjBweCIgeT0iMHB4IiB2aWV3Qm94PSIwIDAgNTY2LjkzIDU2Ni45MyIgZmlsbD0iI2U3ZWJmZiI+DQo8bWV0YWRhdGE+DQogICAgPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIg0KICAgICAgICAgICAgIHhtbG5zOmRjPSJodHRwOi8vcHVybC5vcmcvZGMvZWxlbWVudHMvMS4xLyI+DQogICAgICAgIDxyZGY6RGVzY3JpcHRpb24gYWJvdXQ9IiI+DQogICAgICAgICAgICA8ZGM6Y3JlYXRvcj7msKLnorPpkr54djwvZGM6Y3JlYXRvcj4NCiAgICAgICAgICAgIDxkYzpyaWdodHM+wqkgMjAyNiDmsKLnorPpkr54di4g5L+d55WZ5omA5pyJ5p2D5Yip44CC5pyq57uP6K645Y+v77yM5Lil56aB5aSN5Yi244CB5YiG5Y+R44CB5L+u5pS55oiW55So5LqO5Lu75L2V5ZWG5Lia55uu55qE44CCPC9kYzpyaWdodHM+DQogICAgICAgIDwvcmRmOkRlc2NyaXB0aW9uPg0KICAgIDwvcmRmOlJERj4NCjwvbWV0YWRhdGE+DQo8cGF0aCBkPSJNMjgyLjQ3LDQ5My44OGMtMzQuOTYsMC02Ni43Ni0xNC4wMi05MC41MS0zNi45NEwyOC4zNSw1MDAuNzdsMTIxLjMtMTM3LjgyYy0wLjEyLTIuNDItMC4xOC00Ljg1LTAuMTgtNy4zDQoJYzAtNTYuMTgsMzIuMjUtMTA0LjUzLDc4LjU3LTEyNi4xNWw1NS4wMS0xOTEuN2w1NS4xOSwxOTIuMzNjNDUuNiwyMS45Miw3Ny4yNSw2OS44Nyw3Ny4yNSwxMjUuNTJjMCwxLjY4LTAuMDQsMy4zNS0wLjEsNS4wMQ0KCWwxMjMuMiwxNDAuMTFsLTE2NS4xOC00NC4yNkMzNDkuNjIsNDc5LjY4LDMxNy42NCw0OTMuODgsMjgyLjQ3LDQ5My44OHogTTM1MS45Myw0MjguNTdsMTI0LjA5LDMzLjI1TDM4Mi44OSwzNTUuOQ0KCWMwLjA5LTEuMTksMC4xNi0yLjM5LDAuMjItMy42MWMtMS41Ni00OC4xNi0yNi40Ny03OS45My01OC4yNS05NC41NmwtNDEuNzEtMTQ1LjM1bC00MS40NywxNDQuNQ0KCWMtMzEuNzMsMTQuMDEtNTYuOSw0NS41Ni01OS4zNiw5NS40MWMwLjA2LDEuODEsMC4xNiwzLjU5LDAuMjgsNS4zNUw5MC45LDQ2MS44MmwxMjMuMTItMzIuOTkNCglDMjUxLjc3LDQ2NC45MywzMTQuMzYsNDY1LjYzLDM1MS45Myw0MjguNTd6Ii8+DQo8cGF0aCBkPSJNMzM2LjEsNDExbDk1LjM5LDI1LjU2bC03MS42LTgxLjQzYzAuMDctMC45MiwwLjEzLTEuODQsMC4xNy0yLjc3Yy0xLjItMzcuMDItMjAuMzUtNjEuNDUtNDQuNzgtNzIuNjlsLTMyLjA3LTExMS43Mw0KCWwtMzEuODgsMTExLjA4Yy0yNC4zOSwxMC43Ny00My43NCwzNS4wMi00NS42Myw3My4zNWMwLjA1LDEuMzksMC4xMiwyLjc2LDAuMjIsNC4xMWwtNzAuNDksODAuMDlsOTQuNjQtMjUuMzYNCglDMjU5LjEsNDM4Ljk1LDMwNy4yMSw0MzkuNDgsMzM2LjEsNDExeiIvPg0KPC9zdmc+DQo='

// 顶栏滑块
const toolItems = computed(() => TOOLS.map((t) => ({ value: t.id, label: t.label })))

// 顶栏标题
const titleTool = computed(() => {
  const tool = TOOLS.find((t) => t.id === activeTool.value) ?? TOOLS[0]
  return tool.title ?? tool.label
})
</script>

<template>
  <div class="app-header">
    <a href="?" title="重置页面">
      <img class="app-logo" :src="logo" alt="戴森球蓝图预览" />
    </a>
    戴森球计划·{{ titleTool }} V{{ version }}

    <ToolSlider
      v-model="activeTool"
      class="header-tool-switch"
      :items="toolItems"
    />

    <span class="header-author">by.{{ name }}</span>
  </div>
</template>

<style scoped>
.app-header {
  grid-column: 1 / -1;
  background: var(--bg-panel);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 7px 14px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 1.2rem;
  font-weight: bold;
  flex-shrink: 0;
  flex-wrap: wrap;
  min-width: 0;
}

.app-logo {
  height: 28px;
  width: auto;
  display: block;
}

.header-author {
  margin-left: auto;
  font-weight: normal;
  font-size: 12px;
  opacity: 0.55;
  white-space: nowrap;
}

/* 靠左、每档等宽（指示块才能按档位平移对正） */
.header-tool-switch {
  margin-left: 10px;
}

.header-tool-switch :deep(.tool-slider-btn) {
  flex: 1 1 0;
  justify-content: center;
}

@media (max-width: 960px) {
  .header-tool-switch {
    order: 3;
    margin-left: 0;
  }

  .header-author {
    order: 4;
  }
}
</style>
