import { computed, reactive, ref, shallowRef, toRaw, watch } from 'vue'
import { generateFillGrid, generateFoundationPaint, type FillGrid, type FoundationPaint, type PaintStats } from '../lib/painting/generator'
import { cropsImage, cropRectOf, EQUATOR_LAT_STOPS, EQUATOR_MAX_CROP, EQUATOR_MAX_CROP_POS, equatorLayout, latRangeOf, repeatsForMode, TILE_LAT_ROWS, TILE_LAT_STOPS } from '../lib/painting/projection.js'
import { FOUNDATION_COLOR_COUNT, MAX_COLORS_STOPS } from '../lib/painting/encoder.js'
import {
  BUILTIN_BASES,
  buildPaintedBlueprint,
  infoOf,
  makeBaseFromBlueprint,
} from '../lib/painting/baseBlueprint.js'
import { parseBlueprintString } from '../lib/blueprint/sphere/sphereParser.js'
import { stringifyBlueprint as stringifyFactoryBlueprint } from '../lib/blueprint/factory/factoryEncoder.js'
import { createPlanetGrid, DEFAULT_PLANET_RADIUS } from '../lib/grid/planetGrid.js'
import { forgetImage, loadImage } from '../lib/painting/imageLoader.js'
import { imageAspectError } from '../lib/painting/imageLimits.js'
import { buildFoundationBlueprint } from '../lib/painting/foundationBlueprint.js'
// 投影模式图标: 用 ?raw 取内联 SVG，靠 currentColor 跟随卡片的选中态变色
import hemisphereIcon from '../assets/hemisphere.svg?raw'
import equirectIcon from '../assets/equirect.svg?raw'
import equatorIcon from '../assets/equator.svg?raw'
import tileIcon from '../assets/tile.svg?raw'
import targetSphereIcon from '../assets/target-sphere.svg?raw'
import targetFoundationIcon from '../assets/target-foundation.svg?raw'

export { MAX_COLORS_STOPS, BUILTIN_BASES, TILE_LAT_ROWS }

/**
 * 彩绘生成工具的状态
 * 图片 → 生成模式与投影模式 → 投影采样到涂色网格 → 写进基底（戴森壳）或地基蓝图导出
 * （投影采样在 lib/painting/*，界面在 components/PaintingPanel/*）
 */

export type ProjMode = 'hemisphere' | 'equator' | 'equirect' | 'tile'
export type ResampleFilter = 'nearest' | 'average'
/** 底色（图外填充）来源（none = 没有底色） */
export type FillMode = 'black' | 'white' | 'bg' | 'custom' | 'none'
/** 调色板量化算法: 中位切分 / OKLab + K-means++ */
export type QuantizeMethod = 'median' | 'oklab'
/** 生成模式: 戴森球蓝图（涂色写进壳面）/ 地基蓝图（涂色写进行星表面的地基格子） */
export type PaintMode = 'sphere' | 'foundation'
/** 投影的「类型」: 决定用哪套参数（半球 / 赤道带 / 等距圆柱）；赤道带那两档共用同一套参数 */
export type ProjKind = 'hemisphere' | 'equator' | 'equirect'

export interface ProjModeOption {
  value: ProjMode
  kind: ProjKind
  icon: string
  label: string
  desc: string
}

export interface PaintModeOption {
  value: PaintMode
  icon: string
  label: string
  desc: string
}

export interface QuantizeMethodOption {
  value: QuantizeMethod
  label: string
  desc: string
  /** 是否用到「随机种子」（只有 K-means++ 需要） */
  needsSeed?: boolean
}

/**
 * 量化算法: median 中位切分（确定性）/ oklab 均值聚类（OKLab 里跑 K-means++，种子决定初始中心）
 */
export const QUANTIZE_METHOD_OPTIONS: QuantizeMethodOption[] = [
  { value: 'median', label: '中位切分', desc: '按格数中位切盒子' },
  { value: 'oklab', label: '均值聚类', desc: 'OKLab 感知空间里聚类（用随机种子）', needsSeed: true },
]

/** 投影模式（戴森球那三档） */
const PROJ_MODES: ProjModeOption[] = [
  { value: 'hemisphere', kind: 'hemisphere', icon: hemisphereIcon, label: '半球投影', desc: '正交映射到半球面' },
  { value: 'equator', kind: 'equator', icon: equatorIcon, label: '环绕赤道', desc: '沿赤道等距重复' },
  { value: 'equirect', kind: 'equirect', icon: equirectIcon, label: '球面全景投影', desc: '逆等距圆柱投影到球面上' },
]

/** 生成模式（模式选择里的第一组） */
export const PAINT_MODES: PaintModeOption[] = [
  { value: 'sphere', icon: targetSphereIcon, label: '戴森球蓝图', desc: '生成戴森球壳面涂色' },
  { value: 'foundation', icon: targetFoundationIcon, label: '地基蓝图', desc: '生成自定义地基涂色' },
]

/** 投影模式（地基那三档）: 与戴森球那组一一对应，只是赤道带只铺一份、叫「平铺」 */
const FOUNDATION_PROJ_MODES: ProjModeOption[] = [
  { value: 'hemisphere', kind: 'hemisphere', icon: hemisphereIcon, label: '半球投影', desc: '正交映射到半球面' },
  { value: 'tile', kind: 'equator', icon: tileIcon, label: '平铺', desc: '将图片铺到地基网格上' },
  { value: 'equirect', kind: 'equirect', icon: equirectIcon, label: '球面全景投影', desc: '逆等距圆柱投影到球面上' },
]

const PAINT_KEY = 'dyson-paint-settings'

/** 「参数设置」里可重置的参数: 默认值 + 类型 + 说明的唯一出处，painting 初值由它展开 */
const PAINT_PARAM_DEFAULTS = {
  /** 半球投影的中心经度（度）: 0 = 本初子午线，±180 = 中心转到对侧经线（滑块两端是同一条） */
  hemiLng: 0 as number,
  /** 半球投影的图片缩放（1 = 100% 原样；界面 50%-300%） */
  imgZoom: 1 as number,
  /** 半球投影的图片水平移动: 数值即百分比，n = n% 图片半宽，正 = 东/右（界面限 ±80） */
  imgShiftX: 0 as number,
  /** 半球投影的图片垂直移动: 数值即百分比，n = n% 图片半高，正 = 北/上（界面限 ±80） */
  imgShiftY: 0 as number,
  /** 沿赤道重复的份数（1 - equatorMaxRepeats） */
  equatorRepeats: 1 as number,
  /** 戴森球「环绕赤道」的纬度范围 ±R°（界面 30-72 度） */
  equatorLatSphere: EQUATOR_LAT_STOPS.default as number,
  /** 地基「平铺」的高度 ±R°（界面按格显示 40-180 格 = 14.4°~64.8°） */
  equatorLatFoundation: TILE_LAT_STOPS.default as number,
  /** 垂直裁剪量（0-50%，占图片高度的百分比）: 裁掉的部分相当于放大剩下的内容 */
  equatorCropV: 0 as number,
  /**
   * 垂直裁剪位置（±100%，相对裁剪量）:
   * 正 = 裁剪窗口往上靠（保留上方内容、裁掉下方）；负反之；0 = 上下均分
   */
  equatorCropVPos: 0 as number,
  /** 水平裁剪量（0-50%，占图片宽度的百分比） */
  equatorCropH: 0 as number,
  /**
   * 水平裁剪位置（±100%，相对裁剪量）:
   * 正 = 裁剪窗口往右靠（保留右侧内容、裁掉左侧）；负反之；0 = 左右均分
   */
  equatorCropHPos: 0 as number,
  /** 底色（图外填充）: black / white / bg（图片背景色）/ custom（fillColor）/ none（图外不涂色） */
  fillMode: 'black' as FillMode,
  /** 自定义底色（fillMode === 'custom' 时生效） */
  fillColor: '#000000' as string,
  /** 采样方式: 区域平均 / 最近邻 */
  resample: 'average' as ResampleFilter,
  /** 涂色使用的颜色数量（取 MAX_COLORS_STOPS 的挡位；0 = 不限制） */
  maxColors: 0 as number,
  /** 调色板量化算法: 中位切分 / OKLab + K-means++ */
  quantizeMethod: 'median' as QuantizeMethod,
  /** K-means++ 的随机种子（同一个种子给出同一份调色板，方便复现） */
  quantizeSeed: 1 as number,
  /** 亮度 */
  brightness: 0 as number,
  /** 对比度 */
  contrast: 0 as number,
  /** 饱和度 */
  saturation: 0 as number,
  /** 锐度 */
  sharpness: 0 as number,
}

/** 参数名: 参与重置 / 重新生成 */
type PaintParamKey = keyof typeof PAINT_PARAM_DEFAULTS
export const PAINT_PARAM_KEYS = Object.keys(PAINT_PARAM_DEFAULTS) as PaintParamKey[]

/** 两个生成模式，遍历与存档都按这个顺序 */
const PAINT_MODE_KEYS: PaintMode[] = ['sphere', 'foundation']

/** 两个生成模式各自的「参数设置」那一份（只在内存里，切模式时整份换掉） */
const paramsByPaintMode = reactive<Record<PaintMode, Record<string, unknown>>>({
  sphere: { ...PAINT_PARAM_DEFAULTS },
  foundation: { ...PAINT_PARAM_DEFAULTS },
})

const painting = reactive({
  // ── 输入图片 ──
  imageName: '',  imageUrl: '',
  imageLoading: false,
  imageWidth: 0,
  imageHeight: 0,

  // ── 模式选择 ──
  /** 生成模式: 戴森球蓝图 / 地基蓝图 */
  paintMode: 'sphere' as PaintMode,
  /** 两个生成模式各自的投影模式 */
  projModeByPaintMode: {
    sphere: 'hemisphere',
    foundation: 'hemisphere',
  } as Record<PaintMode, ProjMode>,
  /** 当前生效的投影模式（访问器挂在下面，实际存在 projModeByPaintMode 里） */
  projMode: 'hemisphere' as ProjMode,

  // ── 「参数设置」卡片里的参数（默认值 / 说明都在 PAINT_PARAM_DEFAULTS）──
  ...PAINT_PARAM_DEFAULTS,

  // ── 基底蓝图（界面三项: 两个内置 + 导入的）──
  /** 当前选中的基底 id（base60 / base92 / imported） */
  baseId: 'base60' as string,

  // ── 显示 ──
  /** 预览栏视图: false = 3D 预览，true = 平面展开 */
  showFlatMap: false,
  /** 是否画出经纬线网格 */
  showGridLines: true,
})

/**
 * 当前生效的投影模式 = 当前生成模式那一份，读写都落在 projModeByPaintMode 上
 * 访问器挂在字面量外面: 写进去会自引用，TS 推断成环后 painting 变 any（字段名拼错也不报）
 */
painting.projMode = computed({
  get: () => painting.projModeByPaintMode[painting.paintMode],
  set: (v: ProjMode) => { painting.projModeByPaintMode[painting.paintMode] = v },
}) as unknown as ProjMode

// ─────────────────────────────────────────────────────────────
// 持久化（只存模式与网格线）与生成模式切换
// ─────────────────────────────────────────────────────────────

/** 某个生成模式可用的投影模式列表 */
function projModesOf(paintMode: PaintMode) {
  return paintMode === 'foundation' ? FOUNDATION_PROJ_MODES : PROJ_MODES
}

/** 收集一份参数（切模式时整份带走） */
function collectParams() {
  const out: Record<string, unknown> = {}
  for (const k of PAINT_PARAM_KEYS) out[k] = painting[k]
  return out
}

/** 把一份参数写回 painting（缺的字段回落到默认值） */
function applyParams(record: Record<string, unknown> | null) {
  for (const k of PAINT_PARAM_KEYS) {
    (painting as Record<string, unknown>)[k] = record && record[k] !== undefined
      ? record[k]
      : PAINT_PARAM_DEFAULTS[k]
  }
}

/** 读存档（解析失败 / 缺字段都按默认值处理） */
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

  painting.paintMode = PAINT_MODE_KEYS.includes(data.paintMode) ? data.paintMode : 'sphere'

  // 两个模式各自的投影模式（只认当前这份格式；非法值回落到该模式的第一个）
  for (const paintMode of PAINT_MODE_KEYS) {
    const mode = data.projModeByPaintMode?.[paintMode]
    if (projModesOf(paintMode).some((m) => m.value === mode)) painting.projModeByPaintMode[paintMode] = mode
  }

  if (typeof data.showGridLines === 'boolean') painting.showGridLines = data.showGridLines
}

/** 写存档: 只存生成模式 / 投影模式 / 网格线（纬度范围和参数不存，刷新回默认） */
function saveSettings() {
  try {
    localStorage.setItem(PAINT_KEY, JSON.stringify({
      paintMode: painting.paintMode,
      projModeByPaintMode: painting.projModeByPaintMode,
      showGridLines: painting.showGridLines,
    }))
  } catch {
    /* localStorage 不可用时忽略 */
  }
}

loadSettings()

// 存的那三项任一变化就写一次
watch(
  () => [
    painting.paintMode,
    painting.projMode,
    painting.showGridLines,
  ] as const,
  saveSettings,
)

// 切换生成模式: 参数整份换掉，再保证投影模式在当前列表里可用
watch(() => painting.paintMode, (paintMode, prev) => {
  if (prev) Object.assign(paramsByPaintMode[prev], collectParams())
  applyParams(paramsByPaintMode[paintMode])
  const modes = projModesOf(paintMode)
  if (!modes.some((m) => m.value === painting.projMode)) painting.projMode = modes[0].value
  saveSettings()
})

// ─────────────────────────────────────────────────────────────
// 派生数据
// ─────────────────────────────────────────────────────────────

/** 当前投影模式信息（在当前生成模式可用的那组里找） */
export const currentMode = computed(
  () => availableProjModes.value.find((m) => m.value === painting.projMode) ?? availableProjModes.value[0],
)

/**
 * 是否生成地基蓝图
 * 界面据此隐藏戴森壳基底、把颜色数量锁成 16 色、显示地基调色盘
 */
export const isFoundationMode = computed(() => painting.paintMode === 'foundation')
/** 当前生成模式可用的投影模式（地基那组里赤道带叫「平铺」） */
export const availableProjModes = computed(
  () => (isFoundationMode.value ? FOUNDATION_PROJ_MODES : PROJ_MODES),
)

/** 戴森球「环绕赤道」那档的上下限（界面滑块直接用；地基那头用 TILE_LAT_ROWS） */
export { EQUATOR_LAT_STOPS }

/** 裁剪量 / 裁剪位置的上下限（界面滑块和 projection.js 的限幅共用一份） */
export { EQUATOR_MAX_CROP, EQUATOR_MAX_CROP_POS }

/** 地基彩绘固定用色数（界面显示 + 编码器共用） */
export { FOUNDATION_COLOR_COUNT }

// ── 行星地基网格 ────────────────────────────────────────────

/** 行星地基网格（游戏里行星半径恒为 200；半径做成参数的话再改成 computed） */
export const planetGrid = createPlanetGrid(DEFAULT_PLANET_RADIUS)

/** 预览默认视角正视的经线 = 经度偏移 + 180（三种投影模式一致）；地基位置固定、没有经度偏移 */
export const defaultViewLng = computed(
  () => (isFoundationMode.value ? 180 : painting.hemiLng + 180),
)

// ── 环绕赤道 ────────────────────────────────────────────────

/** 图片宽高比（宽 / 高）: 没载入图片时按 1 算，参数区照样能算排布 */
const imageAspect = computed(() => (
  painting.imageWidth > 0 && painting.imageHeight > 0
    ? painting.imageWidth / painting.imageHeight
    : 1
))

/** 当前生成模式用的高度 / 纬度范围（采样和界面预览共用） */
const currentLatRange = computed(() => latRangeOf(painting))

/** 环绕赤道的排布参数: 与采样共用 equatorLayout，界面显示的数值就是实际涂出来的 */
const equatorInfo = computed(() => equatorLayout({
  latRangeDeg: currentLatRange.value,
  aspect: imageAspect.value,
  repeats: repeatsForMode(painting.projMode, painting.equatorRepeats),
  cropV: painting.equatorCropV,
  cropH: painting.equatorCropH,
  cropVPos: painting.equatorCropVPos,
  cropHPos: painting.equatorCropHPos,
}))

/** 环绕赤道: 重复次数上限（纬度范围、图片宽高比与裁剪量共同决定） */
export const equatorMaxRepeats = computed(() => equatorInfo.value.maxRepeats)

/** 量化图预览要显示的那块图片（裁剪窗口，像素；没裁剪 → null），与采样同一份布局 */
export const quantizedCropRect = computed(() => (
  cropsImage(painting.projMode)
    ? cropRectOf(painting.imageWidth, painting.imageHeight, equatorLayout({
      latRangeDeg: currentLatRange.value,
      aspect: imageAspect.value,
      repeats: repeatsForMode(painting.projMode, painting.equatorRepeats),
      cropV: painting.equatorCropV,
      cropH: painting.equatorCropH,
      cropVPos: painting.equatorCropVPos,
      cropHPos: painting.equatorCropHPos,
      projMode: painting.projMode,
    }))
    : null
))

// 纬度范围或图片比例变了，上限可能变小 → 份数跟着收敛，避免出现超过上限的值
watch(equatorMaxRepeats, (max) => {
  if (painting.equatorRepeats > max) painting.equatorRepeats = max
})

// ── 基底蓝图 ────────────────────────────────────────────────
/** 导入的基底: 只在内存里（刷新即失效） */
const importedBase = shallowRef<{ id: string, label: string, blueprint: any, info: any } | null>(null)

export { importedBase }

/** 可选基底列表: 两个内置 + 已导入的那个 */
const baseOptions = computed(() => (
  importedBase.value ? [...BUILTIN_BASES, importedBase.value] : BUILTIN_BASES
))

/** 当前选中的基底（找不到就回落到第一个内置基底） */
const selectedBase = computed(
  () => baseOptions.value.find((b) => b.id === painting.baseId) ?? BUILTIN_BASES[0],
)

// ─────────────────────────────────────────────────────────────
// 动作
// ─────────────────────────────────────────────────────────────

/**
 * 载入图片文件（本地文件 / 拖放）
 * 长宽比超出 4:1 的图直接拒绝（见 imageLimits.js），此时保留原来那张图
 */
export async function loadImageFile(file: File) {
  if (!file.type.startsWith('image/')) {
    return { ok: false as const, message: '请选择图片文件（PNG / JPG / WebP / GIF）' }
  }

  painting.imageLoading = true
  const url = URL.createObjectURL(file)
  let size: { w: number, h: number } | null = null
  try {
    const img = await loadImage(url)
    size = { w: img.naturalWidth, h: img.naturalHeight }
  } catch {
    size = null
  }

  if (!size) {
    URL.revokeObjectURL(url)
    forgetImage(url)
    painting.imageLoading = false
    return { ok: false as const, message: '图片解码失败，换一张试试' }
  }

  const aspectError = imageAspectError(size.w, size.h)
  if (aspectError) {
    URL.revokeObjectURL(url)
    forgetImage(url)
    painting.imageLoading = false
    return { ok: false as const, message: aspectError }
  }

  // 新图替换旧图: 上一张的 objectURL 和解码结果都放掉
  dropImage(painting.imageUrl)
  painting.imageUrl = url
  painting.imageName = file.name
  painting.imageWidth = size.w
  painting.imageHeight = size.h
  painting.imageLoading = false
  return { ok: true as const }
}

/** 清空已载入的图片 */
export function clearImage() {
  dropImage(painting.imageUrl)
  painting.imageUrl = ''
  painting.imageName = ''
  painting.imageWidth = 0
  painting.imageHeight = 0
  painting.imageLoading = false
}

/** 放掉某个地址的图片（blob URL 顺手撤销；空地址直接跳过） */
function dropImage(url: string) {
  if (!url) return
  forgetImage(url)
  if (url.startsWith('blob:')) URL.revokeObjectURL(url)
}

/** 各投影模式自己的参数: 恢复默认参数只重置当前这一档；没列在这里的是公共参数 */
const PARAM_KEYS_BY_PROJ_MODE: Record<ProjMode, PaintParamKey[]> = {
  hemisphere: ['imgZoom', 'imgShiftX', 'imgShiftY'],
  equator: ['equatorRepeats', 'equatorLatSphere', 'equatorCropH', 'equatorCropHPos', 'equatorCropV', 'equatorCropVPos'],
  tile: ['equatorLatFoundation', 'equatorCropH', 'equatorCropHPos', 'equatorCropV', 'equatorCropVPos'],
  equirect: [],
}

/** 公共参数 = 不属于任何单一投影模式的那些 */
const SHARED_PARAM_KEYS = PAINT_PARAM_KEYS.filter(
  (k) => !Object.values(PARAM_KEYS_BY_PROJ_MODE).some((keys) => keys.includes(k)),
)

/** 恢复默认参数要动的参数名（公共参数 + 当前这一档自己的） */
function currentResetScope() {
  return [...SHARED_PARAM_KEYS, ...PARAM_KEYS_BY_PROJ_MODE[painting.projMode]]
}

/** 是否有参数偏离默认值（只看当前投影模式那一份） */
export const paintParamsDirty = computed(
  () => currentResetScope().some((k) => painting[k] !== PAINT_PARAM_DEFAULTS[k]),
)

/** 重置当前投影模式的参数 */
export function resetPaintParams() {
  for (const k of currentResetScope()) {
    (painting as Record<string, unknown>)[k] = PAINT_PARAM_DEFAULTS[k]
  }
}

// ─────────────────────────────────────────────────────────────
// 彩绘生成（图片 → 涂色网格数据）
// ─────────────────────────────────────────────────────────────

/** 最近一次生成结果（戴森球: 涂色网格） */
export const paintResult = shallowRef<FillGrid | null>(null)
export const paintStats = ref<PaintStats | null>(null)
/** 最近一次生成结果（地基: 调色板 + 每格色号） */
export const foundationResult = shallowRef<FoundationPaint | null>(null)
export const foundationStats = ref<PaintStats | null>(null)
export const generating = ref(false)
let generateToken = 0

/** 生成彩绘数据（按当前生成模式走戴森球 / 地基两条采样） */
export async function generatePainting(): Promise<PaintStats | null> {
  const url = painting.imageUrl
  if (!url) {
    clearPainting()
    return null
  }

  const token = ++generateToken
  generating.value = true
  try {
    // toRaw 取不到 projMode（它是指向「当前模式那一份」的访问器），单独从代理上读出来放进参数
    const params = {
      ...toRaw(painting),
      projMode: painting.projMode,
      imageUrl: url,
    }

    if (isFoundationMode.value) {
      // 地基固定: 16 色、经度偏移 0、图外不铺（行星网格位置固定；填色会整星铺满）
      const result = await generateFoundationPaint(
        { ...params, hemiLng: 0, fillMode: 'none' },
        planetGrid,
      )
      if (token !== generateToken) return null // 已被更新的请求取代
      foundationResult.value = result.paint
      foundationStats.value = result.stats
      paintResult.value = null
      paintStats.value = null
      return result.stats
    }

    // 戴森球: 量化算法固定「中位切分」（界面上只给地基选算法）
    const result = await generateFillGrid({ ...params, quantizeMethod: 'median' })
    if (token !== generateToken) return null
    paintResult.value = result.fillGrid
    paintStats.value = result.stats
    foundationResult.value = null
    foundationStats.value = null
    return result.stats
  } finally {
    if (token === generateToken) generating.value = false
  }
}

/** 清空生成结果（两种模式一起清） */
export function clearPainting() {
  generateToken += 1
  paintResult.value = null
  paintStats.value = null
  foundationResult.value = null
  foundationStats.value = null
  foundationBlueprintCache = null
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
    if (!bp?.singleShell) {
      const name = bp?.typeName || `typeId ${bp?.typeId}`
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

const desc = `\\s403;必须勾选【粘贴地基调色盘设置】\\s403;`

/** 地基蓝图的缓存: 合并矩形 + 编码一次比较费（几十万格），缓存到下次重新生成 */
let foundationBlueprintCache: { paint: FoundationPaint, text: Promise<string> } | null = null

/** 取当前地基彩绘的蓝图字符串（没有就现编一份） */
async function foundationBlueprintString(): Promise<string> {
  const paint = foundationResult.value
  if (!paint) throw new Error('请先生成彩绘')
  if (foundationBlueprintCache?.paint !== paint) {
    // 合并矩形是同步的（几十万格，几十毫秒），编码（gzip + 签名）是异步的
    const bp = buildFoundationBlueprint(planetGrid, paint.palette, paint.index, {
      shortDesc: '地基绘图',
      desc: desc,
      reformType: 2,
      layout: 10,
      icons: [1131, 0, 0, 0, 0],
    })
    const pending = stringifyFactoryBlueprint(bp)
    foundationBlueprintCache = { paint, text: pending }
    // 编码失败别把坏结果留在缓存里，下次点了重新编
    pending.catch(() => {
      if (foundationBlueprintCache?.text === pending) foundationBlueprintCache = null
    })
  }
  return foundationBlueprintCache.text
}

export async function exportPaintingBlueprint(): Promise<string> {
  if (isFoundationMode.value) return foundationBlueprintString()
  if (!paintResult.value) throw new Error('请先生成彩绘')
  return buildPaintedBlueprint(paintResult.value, selectedBase.value.blueprint)
}

export { painting }
