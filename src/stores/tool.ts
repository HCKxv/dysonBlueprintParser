import { ref, watch } from 'vue'

/**
 * 顶部工具切换（标题栏滑动按钮）
 *   preview — 球体预览（球体蓝图预览）
 *   paint   — 彩绘生成（图片投影到涂色网格）
 *   factory — 工厂预览（工厂蓝图信息）
 */
export type ToolId = 'preview' | 'paint' | 'factory'

export interface ToolItem {
  id: ToolId
  /** 按钮文字 */
  label: string
  /** 顶栏标题文字，缺省与 label 相同 */
  title?: string
}

export const TOOLS: ToolItem[] = [
  { id: 'factory', label: '工厂预览', title: '蓝图预览' },
  { id: 'preview', label: '球体预览', title: '蓝图预览' },
  { id: 'paint', label: '彩绘生成' },
]

const TOOL_KEY = 'dyson-preview-tool'

function loadTool(): ToolId {
  try {
    const raw = localStorage.getItem(TOOL_KEY)
    const found = TOOLS.find((t) => t.id === raw)
    if (found) return found.id
  } catch {
    /* localStorage 不可用（隐私模式等）时忽略 */
  }
  return 'preview'
}

export const activeTool = ref<ToolId>(loadTool())

// 落盘: 换工具就记住
watch(activeTool, (v) => {
  try {
    localStorage.setItem(TOOL_KEY, v)
  } catch {
    /* 同上 */
  }
})
