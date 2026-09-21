import { markRaw, reactive, shallowRef, toRaw, watch } from 'vue'
import { parseBlueprintString } from '../lib/blueprint/sphere/blueprintParser.js'
import { extractSingleShell, extractStructure } from '../lib/blueprint/sphere/blueprintEdit.js'
import { stringifyBlueprint } from '../lib/blueprint/sphere/blueprintEncoder.js'
import { computePower, fmtKW } from '../lib/power/power.js'
import { computePointsAsync } from '../lib/power/powerAsync.js'
import { buildStatsTree, type StatNode } from '../components/BlueprintPanel/statsTree'
import { downloadTxt } from '../utils/download'
import { useToast } from '../composables/useToast'

/** DysonSpherePreview 的命令式子集（由 PreviewPanel 注入实例） */
export interface DysonPreview {
  render(body: unknown): Promise<void> | void
  clearScene(): void
  setLayerVisible(type: 'shell' | 'cloud', id: number, visible: boolean): void
  setGridVisible(visible: boolean): void
  setRotationEnabled(enabled: boolean): void
  setRotationSpeed(speed: number): void
  setSunColor(luminosity: number): void
  setBackgroundMode(mode: 'plain' | 'star'): void
  setQuality(level: 'low' | 'high'): void
}

const toast = useToast()

// 响应式全局状态
const store = reactive({
  // 蓝图输入与解析结果
  input: '',
  parsing: false,
  parsed: null as Record<string, any> | null,
  powerResult: null as Record<string, any> | null,
  powerText: '0 W',
  statsTree: [] as StatNode[],
  errorMessage: '',
  showRadiusInput: true,

  // 设置
  radius: 10000,
  luminosity: 1.0,
  isNode: true,
  isFrame: true,
  isFaces: true,
  gridVisible: true,
  rotateEnabled: true,
  speed: 0.05,
  background: 'plain' as 'plain' | 'star',
  quality: 'high' as 'low' | 'high',
  menuCollapsed: true,

  showCopyShellModal: false,
})

// ─────────────────────────────────────────────────────────────
// 显示设置本地持久化（localStorage）
// ─────────────────────────────────────────────────────────────
const SETTINGS_KEY = 'dyson-preview-settings'

/** 从 localStorage 恢复显示设置 */
function loadDisplaySettings() {
  let data: Record<string, unknown>
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return
    data = JSON.parse(raw)
  } catch {
    return // 数据损坏时忽略，使用默认值
  }
  if (!data || typeof data !== 'object') return
  if (typeof data.gridVisible === 'boolean') store.gridVisible = data.gridVisible
  if (typeof data.rotateEnabled === 'boolean') store.rotateEnabled = data.rotateEnabled
  if (data.speed === 0.01 || data.speed === 0.05 || data.speed === 0.2) store.speed = data.speed
  if (data.background === 'plain' || data.background === 'star') store.background = data.background
  if (data.quality === 'low' || data.quality === 'high') store.quality = data.quality
}

/** 将显示设置写入 localStorage */
function saveDisplaySettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      gridVisible: store.gridVisible,
      rotateEnabled: store.rotateEnabled,
      speed: store.speed,
      background: store.background,
      quality: store.quality,
    }))
  } catch {
    /* localStorage 不可用（隐私模式等）时忽略 */
  }
}

loadDisplaySettings()

// 显示设置变化时自动保存
watch(
  () => [store.gridVisible, store.rotateEnabled, store.speed, store.background] as const,
  saveDisplaySettings,
)

// ─────────────────────────────────────────────────────────────
// 3D 预览实例（由 PreviewPanel 在挂载时注入）
// ─────────────────────────────────────────────────────────────
const preview = shallowRef<DysonPreview | null>(null)

/** 注入预览实例 */
export function setPreview(instance: DysonPreview | null) {
  preview.value = instance
  if (!instance) return
  // 挂载时把已保存的显示设置应用到预览实例
  instance.setGridVisible(store.gridVisible)
  instance.setRotationEnabled(store.rotateEnabled)
  instance.setRotationSpeed(store.speed)
  instance.setBackgroundMode(store.background)
  instance.setQuality(store.quality)

  instance.setSunColor(clampLum(store.luminosity))
  if (store.parsed) {
    // 切回「蓝图预览」时先把工具界面绘制出来，再重建 3D 场景：
    afterPaint(() => {
      // 这两帧内可能又切走或换了实例，此时不该再渲染
      if (preview.value !== instance || !store.parsed) return
      instance.render(toRaw(store.parsed.body))
    })
  }
}

// ─────────────────────────────────────────────────────────────
// 工具
// ─────────────────────────────────────────────────────────────
function clampLum(v: number): number {
  if (Number.isNaN(v) || v <= 0) return 0.1
  if (v > 10) return 10
  return v
}

function clampRadius(v: number): number {
  if (Number.isNaN(v) || v < 4000) return 4000
  return v
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

/**
 * 等界面真正绘制出一帧后再执行回调
 */
function afterPaint(callback: () => void): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => callback())
  })
}

// ─────────────────────────────────────────────────────────────
// 动作
// ─────────────────────────────────────────────────────────────

/** 刷新发电量显示（光度 / 节点 / 框架 / 壳面变化时调用） */
export function refreshPower() {
  if (!store.powerResult) return
  store.powerText = fmtKW(
    computePower(
      store.powerResult,
      clampLum(store.luminosity),
      store.isNode,
      store.isFrame,
      store.isFaces,
    ),
  )
}

/** 构建信息面板节点树 */
function buildTree(parsed: Record<string, any>, powerResult: Record<string, any> | null) {
  store.statsTree = buildStatsTree(parsed, powerResult, {
    onExportShell: exportShellLayer,
    onExportStructure: exportStructure,
    onExportBlueprint: exportBlueprint,
    onCopyToMultiLayer: openCopyShellModal,
    onLayerVisible: setLayerVisible,
  })
}

/** 计算结构与细胞点数并更新 */
async function updatePoints() {
  const parsed = store.parsed
  if (!parsed) return

  store.powerText = '计算中...'
  let powerResult: Record<string, any> | null
  try {
    powerResult = await computePointsAsync(toRaw(parsed.body), clampRadius(store.radius), { key: 'preview' })
  } catch (error) {
    if ((error as Error).name === 'AbortError' || parsed !== store.parsed) return
    store.powerText = '计算失败'
    store.powerResult = null
    toast.show(`发电量计算失败：\n${(error as Error).message}`)
    return
  }
  if (parsed !== store.parsed) return   // 期间换了蓝图: 这次结果作废

  store.powerResult = powerResult
  if (powerResult) {
    refreshPower()
  } else {
    store.powerText = '0 W'   // 没有壳数据（例如只有戴森云）
  }
  buildTree(parsed, powerResult)
}

/** 解析并预览输入框中的蓝图字符串 */
export async function parseBlueprint() {
  const text = store.input.trim()
  if (!text) return

  toast.show('解析蓝图中...', 10000)
  store.parsing = true
  store.errorMessage = ''
  store.parsed = null
  store.powerResult = null
  store.powerText = '0 W'
  store.statsTree = []

  preview.value?.clearScene()
  await nextFrame() // 等待下一帧，确保禁用样式已应用

  try {
    const parsed = await parseBlueprintString(text)

    store.showRadiusInput = parsed.body.typeId === 1
    buildTree(parsed, null)
    // markRaw：蓝图数据不需要深层响应式（面板由 statsTree / powerResult 驱动）。
    // 若交给 Vue 代理，编码 / 提取时库内 { ...node } 式展开会把嵌套代理写回数据，
    // 之后 structuredClone 就会抛「#<Object> could not be cloned」
    store.parsed = markRaw(parsed)
    updatePoints()
    preview.value?.render(parsed.body)

    toast.show('成功解析蓝图')
  } catch (error) {
    store.errorMessage = (error as Error).message
    toast.show(`解析蓝图失败：\n${(error as Error).message}`)
  } finally {
    store.parsing = false
  }
}

/** 重置：清空已解析的蓝图 */
export function resetBlueprint() {
  store.parsed = null
  store.powerResult = null
  store.powerText = '0 W'
  store.statsTree = []
  store.errorMessage = ''
  store.showRadiusInput = true
  store.parsing = false
  preview.value?.clearScene()
  toast.show('已清空蓝图')
}

/** 单层壳半径变化：重新计算结构与细胞点数（随半径变化） */
export async function onRadiusChange() {
  store.radius = clampRadius(store.radius)
  if (store.parsed?.body?.typeId !== 1) return
  await updatePoints()
}

/** 光度系数变化：更新恒星颜色并刷新发电量 */
export function onLuminosityChange() {
  const val = clampLum(store.luminosity)
  store.luminosity = val
  preview.value?.setSunColor(val)
  refreshPower()
}

/** 壳层 / 云轨道显示开关 */
export function setLayerVisible(type: 'shell' | 'cloud', id: number, visible: boolean) {
  preview.value?.setLayerVisible(type, id, visible)
}

/** 提取多层壳中的某个壳层 */
export async function exportShellLayer(orbitId: number) {
  const parsed = store.parsed
  if (!parsed) {
    toast.show('当前没有已解析的蓝图')
    return
  }
  try {
    const single = extractSingleShell(toRaw(parsed), orbitId)
    const text = await stringifyBlueprint(single)
    downloadTxt(text, `壳层${orbitId}`)
    await navigator.clipboard.writeText(text)
    toast.show(`已提取壳层 ${orbitId} 为单层壳蓝图，并复制到剪贴板`)
  } catch (error) {
    toast.show(`提取壳层失败：\n${(error as Error).message}`)
  }
}

/** 打开生成多层弹窗 */
export function openCopyShellModal() {
  const parsed = store.parsed
  if (!parsed) {
    toast.show('当前没有已解析的蓝图')
    return
  }
  if (parsed.body?.typeId !== 1) {
    toast.show('仅单层壳蓝图支持复制到多层')
    return
  }
  store.showCopyShellModal = true
}

/** 关闭生成多层弹窗 */
export function closeCopyShellModal() {
  store.showCopyShellModal = false
}

/** 提取戴森壳或云 */
export async function exportStructure(type:'shell'|'cloud') {
  const parsed = store.parsed
  if (!parsed) {
    toast.show('当前没有已解析的蓝图')
    return
  }
  try {
    const single = extractStructure(toRaw(parsed), type)
    const text = await stringifyBlueprint(single)
    downloadTxt(text, type === 'shell' ? '戴森壳' : '戴森云')
    await navigator.clipboard.writeText(text)
    toast.show(`已提取为${type==='shell'? '戴森壳':'戴森云'}蓝图，并复制到剪贴板`)
  } catch (error) {
    toast.show(`提取蓝图失败：\n${(error as Error).message}`)
  }
}

/** 导出蓝图 */
export async function exportBlueprint() {
  const parsed = store.parsed
  if (!parsed) {
    toast.show('当前没有已解析的蓝图')
    return
  }
  try {
    const text = await stringifyBlueprint(toRaw(parsed))
    downloadTxt(text, '戴森球')
    toast.show('已将蓝图导出到下载目录')
  } catch (error) {
    toast.show(`导出蓝图失败：\n${(error as Error).message}`)
  }
}

/** 刻度显示开关 */
export function setGridVisible(visible: boolean) {
  store.gridVisible = visible
  preview.value?.setGridVisible(visible)
}

/** 旋转开关 */
export function setRotationEnabled(enabled: boolean) {
  store.rotateEnabled = enabled
  preview.value?.setRotationEnabled(enabled)
}

/** 转速 */
export function setRotationSpeed(speed: number) {
  store.speed = speed
  preview.value?.setRotationSpeed(speed)
}

/** 背景切换（纯色 / 星空） */
export function setBackground(mode: 'plain' | 'star') {
  store.background = mode
  preview.value?.setBackgroundMode(mode)
}

/** 切换画质档位 */
export function setQuality(level: 'low' | 'high') {
  store.quality = level
  preview.value?.setQuality(level)
  saveDisplaySettings()
}

/** 处理拖放得到的蓝图文本/文件内容，校验后自动解析 */
export function handleBlueprintText(text: string) {
  const trimmed = (text || '').trim()
  if (!trimmed) {
    toast.show('内容为空')
    return
  }
  if (!trimmed.startsWith('DYBP:')) {
    toast.show('内容不是有效的蓝图')
    return
  }

  store.input = trimmed
  parseBlueprint()
}

export { store }
