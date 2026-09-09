import { reactive, shallowRef, toRaw, watch } from 'vue'
import { parseBlueprintString } from '../lib/blueprint/blueprintParser.js'
import { verifyBlueprintString } from '../lib/blueprint/blueprintChecksum.js'
import { extractSingleShell, extractStructure } from '../lib/blueprint/blueprintEdit.js'
import { stringifyBlueprint } from '../lib/blueprint/blueprintEncoder.js'
import { computePoints, computePower, fmtKW } from '../lib/power/power.js'
import { buildStatsTree, type StatNode } from '../components/StatsPanel/statsTree'
import { loadBlueprintFromUrl } from '../utils/urlLoader'
import { downloadTxt } from '../utils/download'
import { useToast } from '../composables/useToast'

/** DysonSpherePreview 的命令式子集（由 PreviewPanel 注入实例） */
export interface DysonPreview {
  render(body: unknown): void
  clearScene(): void
  setLayerVisible(type: 'shell' | 'cloud', id: number, visible: boolean): void
  setGridVisible(visible: boolean): void
  setRotationEnabled(enabled: boolean): void
  setRotationSpeed(speed: number): void
  setSunColor(luminosity: number): void
  setBackgroundMode(mode: 'plain' | 'star'): void
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
  isSingleShell: false,

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
}

/** 将显示设置写入 localStorage */
function saveDisplaySettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      gridVisible: store.gridVisible,
      rotateEnabled: store.rotateEnabled,
      speed: store.speed,
      background: store.background,
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

export function setPreview(instance: DysonPreview | null) {
  preview.value = instance
  // 挂载时把已保存的显示设置应用到预览实例
  if (instance) {
    instance.setGridVisible(store.gridVisible)
    instance.setRotationEnabled(store.rotateEnabled)
    instance.setRotationSpeed(store.speed)
    instance.setBackgroundMode(store.background)
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

/** 解析成功后：3D 渲染 + 发电量计算 + 信息面板 */
function renderFromParsed(parsed: Record<string, any>) {
  preview.value?.render(parsed.body)
  store.isSingleShell = parsed.body.typeId === 1

  const userRadius = clampRadius(store.radius || 10000)
  store.radius = userRadius
  const powerResult = computePoints(parsed.body, store.isSingleShell ? userRadius : null)
  if (!powerResult) {
    store.powerText = '0 W'
    store.powerResult = null
  } else {
    const lum = clampLum(store.luminosity)
    store.luminosity = lum
    store.powerText = fmtKW(computePower(powerResult, lum, store.isNode, store.isFrame, store.isFaces))
    store.powerResult = powerResult
    preview.value?.setSunColor(lum)
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
    parsed.validFlag = verifyBlueprintString(text)
    renderFromParsed(parsed)
    store.parsed = parsed
    toast.show('成功解析蓝图')
  } catch (error) {
    store.errorMessage = (error as Error).message
    toast.show(`解析蓝图失败：\n${(error as Error).message}`)
  } finally {
    store.parsing = false
  }
}

/** 单层壳半径变化：重新计算结构与细胞点数（随半径变化） */
export function onRadiusChange() {
  const val = clampRadius(store.radius)
  store.radius = val

  if (store.parsed?.body?.typeId !== 1) return
  const powerResult = computePoints(store.parsed.body, val)
  if (!powerResult) return
  store.powerResult = powerResult
  refreshPower()
  // 重渲染信息面板（结构/细胞点数随半径变化）
  buildTree(store.parsed, powerResult)
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
    const name = `壳层${orbitId}_${Date.now()}`
    downloadTxt(text, name)
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
    downloadTxt(text, `${type==='shell'? '戴森壳':'戴森云'}_${Date.now()}`)
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
    const text = await stringifyBlueprint(store.parsed)
    const name = `戴森球_${Date.now()}`
    downloadTxt(text, name)
    toast.show(`已将蓝图导出到 ${name}`)
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

/** URL 参数加载（?txt=...）：由 App.vue 在挂载时调用一次 */
export function loadUrlBlueprint() {
  loadBlueprintFromUrl({
    onLoadStart: () => toast.show('正在加载蓝图'),
    onLoaded: (text) => {
      store.input = text
      parseBlueprint()
    },
    onError: (e) => toast.show(`加载蓝图失败：\n${e.message}`),
  })
}

export { store }
