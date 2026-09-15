import { ref, watch } from 'vue'

/**
 * 顶部工具切换（标题栏滑动按钮）
 *   preview — 蓝图预览（现有功能）
 *   paint   — 彩绘生成（图片投影到涂色网格）
 */
export type ToolId = 'preview' | 'paint'

export interface ToolItem {
  id: ToolId
  label: string
  desc?: string
}

export const TOOLS: ToolItem[] = [
  { id: 'preview', label: '蓝图预览'},
  { id: 'paint', label: '彩绘生成'},
]

const TOOL_KEY = 'dyson-preview-tool'

function loadTool(): ToolId {
  try {
    const raw = localStorage.getItem(TOOL_KEY)
    if (raw === 'preview' || raw === 'paint') return raw
  } catch {
    /* localStorage 不可用（隐私模式等）时忽略 */
  }
  return 'preview'
}

export const activeTool = ref<ToolId>(loadTool())

watch(activeTool, (v) => {
  try {
    localStorage.setItem(TOOL_KEY, v)
  } catch {
    /* 同上 */
  }
})

/** 切换工具 */
export function setTool(id: ToolId) {
  activeTool.value = id
}
