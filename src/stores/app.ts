import { reactive, shallowRef } from 'vue'
import { parseBlueprintString } from '../lib/blueprint/blueprintParser.js'
import { verifyBlueprintString } from '../lib/blueprint/blueprintChecksum.js'
import { computePoints, computePower, fmtKW } from '../lib/power/power.js'
import { buildStatsTree, type StatNode } from '../lib/statsTree'
import { loadBlueprintFromUrl } from '../lib/urlLoader'
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
  menuCollapsed: true,
})

// ─────────────────────────────────────────────────────────────
// 3D 预览实例（由 PreviewPanel 在挂载时注入）
// ─────────────────────────────────────────────────────────────
const preview = shallowRef<DysonPreview | null>(null)

export function setPreview(instance: DysonPreview | null) {
  preview.value = instance
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

  store.statsTree = buildStatsTree(parsed, powerResult)
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
  store.statsTree = buildStatsTree(store.parsed, powerResult)
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
