import { computed, reactive, ref, shallowRef, toRaw, watch } from 'vue'
import { generateFillGrid, type FillGrid, type PaintStats } from '../lib/painting/generator'
import { EQUATOR_DEFAULT_LAT, equatorLayout } from '../lib/painting/projection.js'
import { MAX_COLORS_STOPS } from '../lib/painting/encoder.js'
import {
  BUILTIN_BASES,
  buildPaintedBlueprint,
  infoOf,
  makeBaseFromBlueprint,
} from '../lib/painting/baseBlueprint.js'
import { parseBlueprintString } from '../lib/blueprint/blueprintParser.js'
// 投影模式图标: 用 ?raw 取内联 SVG，靠 currentColor 跟随卡片的选中态变色
import hemisphereIcon from '../assets/hemisphere.svg?raw'
import equirectIcon from '../assets/equirect.svg?raw'
import equatorIcon from '../assets/equator.svg?raw'

export { MAX_COLORS_STOPS, BUILTIN_BASES }

/**
 * 彩绘生成工具的状态
 *
 * 流程: 输入图片 → 投影映射到涂色网格 → 生成涂色数据 → 写进选中的基底蓝图并导出
 * （投影与采样在 lib/painting/*，界面在 components/PaintingPanel/*）
 */

export type ProjMode = 'hemisphere' | 'equirect' | 'equator'
export type ResampleFilter = 'nearest' | 'average'
/** 底色（图外填充）来源（none = 没有底色） */
export type FillMode = 'black' | 'white' | 'bg' | 'custom' | 'none'

export interface ProjModeOption {
  value: ProjMode
  icon: string
  label: string
  desc: string
}

/** 投影模式 */
export const PROJ_MODES: ProjModeOption[] = [
  { value: 'hemisphere', icon: hemisphereIcon, label: '半球投影', desc: '正交映射到半球面' },
  { value: 'equator', icon: equatorIcon, label: '环绕赤道', desc: '沿赤道等距重复' },
  { value: 'equirect', icon: equirectIcon, label: '球面全景投影', desc: '逆等距圆柱投影到球面上' },
]

const PAINT_KEY = 'dyson-paint-settings'

const painting = reactive({
  // ── 输入图片 ──
  imageName: '',
  imageUrl: '',
  imageLoading: false,
  imageWidth: 0,
  imageHeight: 0,

  // ── 模式选择 ──
  projMode: 'hemisphere' as ProjMode,
  /** 半球投影的中心经度（度）: 0 = 本初子午线，±180 = 中心转到对侧经线（滑块两端是同一条） */
  hemiLng: 0,
  /** 半球投影的图片缩放（1 = 100% 原样；界面 50%-300%） */
  imgZoom: 1,
  /** 半球投影的图片水平移动: 数值即百分比，n = n% 图片半宽，正 = 东/右（界面限 ±80） */
  imgShiftX: 0,
  /** 半球投影的图片垂直移动: 数值即百分比，n = n% 图片半高，正 = 北/上（界面限 ±80） */
  imgShiftY: 0,

  // ── 环绕赤道 ──
  /** 环带的纬度范围 ±R°（界面 30-72）: 图片高度 = 2R，宽 = 2R × 宽高比 */
  equatorLat: EQUATOR_DEFAULT_LAT as number,
  /** 沿赤道重复的份数（1 - equatorMaxRepeats） */
  equatorRepeats: 1,

  // ── 投影参数 ──
  /**
   * 底色（图外填充）来源
   *   black / white — 固定黑白
   *   bg            — 取图片自身背景色（四角取色、排除明显不一样的角）
   *   custom        — 用 fillColor
   *   none          — 没有底色，这些格子不涂色
   */
  fillMode: 'black' as FillMode,
  /** 自定义底色（fillMode === 'custom' 时生效） */
  fillColor: '#000000',

  // ── 采样与色彩参数 ──
  resample: 'average' as ResampleFilter,
  /** 涂色使用的颜色数量（取 MAX_COLORS_STOPS 的挡位；0 = 不限制） */
  maxColors: 0,

  // ── 画面效果 ──
  /** 亮度 */
  brightness: 0,
  /** 对比度 */
  contrast: 0,
  /** 饱和度 */
  saturation: 0,
  /** 锐度 */
  sharpness: 0,

  // ── 基底蓝图（界面三项: 两个内置 + 导入的）──
  /** 当前选中的基底 id（base60 / base92 / imported） */
  baseId: 'base60' as string,

  // ── 显示 ──
  /** 预览栏视图: false = 3D 预览，true = 平面展开 */
  showFlatMap: false,
  /** 是否画出经纬线网格 */
  showGridLines: true,
})

// ─────────────────────────────────────────────────────────────
// 持久化（localStorage）
// ─────────────────────────────────────────────────────────────
function loadSettings() {
  let data: Record<string, any>
  try {
    const raw = localStorage.getItem(PAINT_KEY)
    if (!raw) return
    data = JSON.parse(raw)
  } catch {
    return
  }
  if (!data || typeof data !== 'object') return

  if (PROJ_MODES.some((m) => m.value === data.projMode)) painting.projMode = data.projMode
  if (typeof data.showGridLines === 'boolean') painting.showGridLines = data.showGridLines
}

function saveSettings() {
  try {
    localStorage.setItem(PAINT_KEY, JSON.stringify({
      projMode: painting.projMode,
      showGridLines: painting.showGridLines,
    }))
  } catch {
    /* localStorage 不可用时忽略 */
  }
}

loadSettings()

watch(
  () => [painting.projMode, painting.showGridLines] as const,
  saveSettings,
)

// ─────────────────────────────────────────────────────────────
// 派生数据
// ─────────────────────────────────────────────────────────────

/** 当前投影模式信息 */
export const currentMode = computed(
  () => PROJ_MODES.find((m) => m.value === painting.projMode) ?? PROJ_MODES[0],
)

// ── 环绕赤道 ────────────────────────────────────────────────

/** 图片宽高比（宽 / 高）: 没载入图片时按 1 算，参数区照样能算排布 */
export const imageAspect = computed(() => (
  painting.imageWidth > 0 && painting.imageHeight > 0
    ? painting.imageWidth / painting.imageHeight
    : 1
))

/**
 * 环绕赤道的排布参数（份数 / 每份宽度 / 次数上限）
 * 与生成彩绘共用 lib/painting 的 equatorLayout，界面显示的数值就是实际涂出来的
 */
export const equatorInfo = computed(() => equatorLayout({
  latRangeDeg: painting.equatorLat,
  aspect: imageAspect.value,
  repeats: painting.equatorRepeats,
}))

/** 环绕赤道: 重复次数上限（纬度范围与图片宽高比共同决定） */
export const equatorMaxRepeats = computed(() => equatorInfo.value.maxRepeats)

// 纬度范围或图片比例变了，上限可能变小 → 份数跟着收敛，避免出现超过上限的值
watch(equatorMaxRepeats, (max) => {
  if (painting.equatorRepeats > max) painting.equatorRepeats = max
})

// ── 基底蓝图 ────────────────────────────────────────────────
/** 导入的基底: 只在内存里（刷新即失效） */
const importedBase = shallowRef<{ id: string, label: string, blueprint: any, info: any } | null>(null)

export { importedBase }

/** 可选基底列表: 两个内置 + 已导入的那个 */
export const baseOptions = computed(() => (
  importedBase.value ? [...BUILTIN_BASES, importedBase.value] : BUILTIN_BASES
))

/** 当前选中的基底（找不到就回落到第一个内置基底） */
export const selectedBase = computed(
  () => baseOptions.value.find((b) => b.id === painting.baseId) ?? BUILTIN_BASES[0],
)

// ─────────────────────────────────────────────────────────────
// 动作
// ─────────────────────────────────────────────────────────────

/** 载入图片文件（本地文件 / 拖放） */
export function loadImageFile(file: File) {
  if (!file.type.startsWith('image/')) {
    return { ok: false as const, message: '请选择图片文件（PNG / JPG / WebP / GIF）' }
  }
  // 释放上一张图片的 objectURL
  if (painting.imageUrl.startsWith('blob:')) URL.revokeObjectURL(painting.imageUrl)

  painting.imageLoading = true
  painting.imageName = file.name

  const url = URL.createObjectURL(file)
  const img = new Image()
  img.onload = () => {
    painting.imageUrl = url
    painting.imageWidth = img.naturalWidth
    painting.imageHeight = img.naturalHeight
    painting.imageLoading = false
  }
  img.onerror = () => {
    URL.revokeObjectURL(url)
    painting.imageUrl = ''
    painting.imageWidth = 0
    painting.imageHeight = 0
    painting.imageLoading = false
  }
  img.src = url
  return { ok: true as const }
}

/** 清空已载入的图片 */
export function clearImage() {
  if (painting.imageUrl.startsWith('blob:')) URL.revokeObjectURL(painting.imageUrl)
  painting.imageUrl = ''
  painting.imageName = ''
  painting.imageWidth = 0
  painting.imageHeight = 0
  painting.imageLoading = false
}

export const PAINT_PARAM_DEFAULTS = {
  hemiLng: 0,
  imgZoom: 1,
  imgShiftX: 0,
  imgShiftY: 0,
  equatorLat: EQUATOR_DEFAULT_LAT,
  equatorRepeats: 1,
  fillMode: 'black',
  fillColor: '#000000',
  resample: 'average',
  maxColors: 0,
  brightness: 0,
  contrast: 0,
  saturation: 0,
  sharpness: 0,
} as const

/** 参与重置的参数名 */
const PAINT_PARAM_KEYS = Object.keys(PAINT_PARAM_DEFAULTS) as Array<keyof typeof PAINT_PARAM_DEFAULTS>

/**
 * 是否有参数偏离默认值
 */
export const paintParamsDirty = computed(() => (
  PAINT_PARAM_KEYS.some((k) => painting[k] !== PAINT_PARAM_DEFAULTS[k])
))

/**
 * 重置「参数设置」卡片里的参数
 * 涉及: 经度偏移 / 图片缩放与移动 / 图外填充 / 重采样 / 颜色数量
 * 不动投影模式、预览栏与已载入的图片
 */
export function resetPaintParams() {
  // 默认值表是 painting 对应字段的子集（字面量窄类型 → 各自字段类型）
  Object.assign(painting as Record<string, unknown>, PAINT_PARAM_DEFAULTS)
}

// ─────────────────────────────────────────────────────────────
// 彩绘生成（图片 → 涂色网格数据）
// ─────────────────────────────────────────────────────────────

/** 最近一次生成结果 */
export const paintResult = shallowRef<FillGrid | null>(null)
export const paintStats = ref<PaintStats | null>(null)
export const generating = ref(false)
let generateToken = 0

/** 生成彩绘数据 */
export async function generatePainting(): Promise<PaintStats | null> {
  const url = painting.imageUrl
  if (!url) {
    paintResult.value = null
    paintStats.value = null
    return null
  }

  const token = ++generateToken
  generating.value = true
  try {
    const result = await generateFillGrid({ ...toRaw(painting), imageUrl: url })
    if (token !== generateToken) return null // 已被更新的请求取代
    paintResult.value = result.fillGrid
    paintStats.value = result.stats
    return result.stats
  } finally {
    if (token === generateToken) generating.value = false
  }
}

/** 清空生成结果 */
export function clearPainting() {
  generateToken += 1
  paintResult.value = null
  paintStats.value = null
  generating.value = false
}

// ─────────────────────────────────────────────────────────────
// 基底蓝图
// ─────────────────────────────────────────────────────────────

/** 选中某个基底 */
export function selectBase(id: string) {
  if (baseOptions.value.some((b) => b.id === id)) painting.baseId = id
}

/**
 * 导入蓝图当基底（只接受 typeId = 1 的单层戴森壳），导入后自动选中
 * @param {string|File|Blob} source 蓝图字符串，或装着蓝图字符串的文件
 * @param {string} [label] 选项显示名（默认用文件名 / 「导入的蓝图」）
 */
export async function importBaseBlueprint(
  source: string | File | Blob,
  label?: string,
): Promise<{ ok: boolean, message: string }> {
  try {
    const isFile = typeof source !== 'string'
    const text = (isFile ? await source.text() : source).trim()
    if (!text) return { ok: false, message: '蓝图内容是空的' }

    const bp = await parseBlueprintString(text)
    if (!bp?.body?.singleShell) {
      const name = bp?.header?.typeName || `typeId ${bp?.header?.typeId}`
      return { ok: false, message: `只支持单层戴森壳蓝图（这份是「${name}」）` }
    }

    const blueprint = makeBaseFromBlueprint(bp)
    const info = infoOf(blueprint)
    if (!info.nodes) return { ok: false, message: '这份蓝图里没有节点' }

    const name = label || (isFile ? (source as File).name : '') || '导入的蓝图'
    importedBase.value = { id: 'imported', label: name, blueprint, info }
    painting.baseId = 'imported'
    return { ok: true, message: `已导入基底：${name}` }
  } catch (error) {
    return { ok: false, message: `无法解析蓝图：${(error as Error).message}` }
  }
}

/** 移除已导入的基底（回到第一个内置基底） */
export function clearImportedBase() {
  importedBase.value = null
  if (painting.baseId === 'imported') painting.baseId = BUILTIN_BASES[0].id
}

// ─────────────────────────────────────────────────────────────
// 导出彩绘蓝图
// ─────────────────────────────────────────────────────────────

/**
 * 把当前彩绘写进选中的基底蓝图，编成蓝图字符串
 */
export async function exportPaintingBlueprint(): Promise<string> {
  if (!paintResult.value) throw new Error('请先生成彩绘')
  return buildPaintedBlueprint(paintResult.value, selectedBase.value.blueprint)
}

export { painting }
