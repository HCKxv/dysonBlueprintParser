import { computed, markRaw, reactive } from 'vue'
import { parseBlueprintString } from '../lib/blueprint/factory/factoryParser.js'
import { stringifyBlueprint } from '../lib/blueprint/factory/factoryEncoder.js'
import { itemName } from '../lib/blueprint/factory/factoryItems.js'
import { saveAsText } from '../utils/download'

/** 工厂预览工具的状态 */

/** 设施（按建筑 id 聚合） */
export interface FactoryFacility {
  itemId: number
  name: string
  count: number
}

/** 蓝图自定义属性 */
export interface FactoryProperty {
  /** 属性名 */
  key: string
  /** 属性值 */
  value: string
}

/** 蓝图头部 */
export interface FactoryHeader {
  /** 图标布局（0 / 1 = 不显示图标，取值见 FactoryThumb 的排布表） */
  layout: number
  /** 缩略图的 5 个图标位（0 = 空位） */
  icons: number[]
  /** 创建时间戳（.NET ticks） */
  timeTicks: string | null
  /** 创建时间（由创建时间戳换算） */
  time: string | null
  /** 创建版本号 */
  gameVersion: string
  /** 缩略图文字 */
  shortDesc: string
  /** 作者 */
  author: string
  /** 版本 */
  customVersion: string
  /** 自定义属性 */
  properties: FactoryProperty[]
  /** 蓝图介绍 */
  desc: string
}

/** 一份工厂蓝图对象 */
export type FactoryBlueprint = { header: FactoryHeader } & Record<string, any>

export const factory = reactive({
  /** 正在解析 */
  parsing: false,
  /** 「打开蓝图」弹窗 */
  showOpenModal: false,
  /** 完整蓝图数据 */
  blueprint: null as FactoryBlueprint | null,
  /** 头部: 用于显示和编辑 */
  header: reactive(emptyHeader()),
  /** 当前蓝图对应的原文件句柄（File System Access API） */
  fileHandle: null as FileSystemFileHandle | null,
})

/** 空白蓝图头部 */
function emptyHeader(): FactoryHeader {
  return {
    layout: 1,
    icons: [0, 0, 0, 0, 0],
    timeTicks: null,
    time: null,
    gameVersion: '',
    shortDesc: '',
    author: '',
    customVersion: '',
    properties: [],
    desc: '',
  }
}

// ─────────────────────────────────────────────────────────────
// 工具
// ─────────────────────────────────────────────────────────────

function text(value: unknown): string {
  return typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value)
}

/** 头部拷贝（缺的字段补默认值） */
function copyHeader(head: any): FactoryHeader {
  return {
    layout: Number(head?.layout) || 0,
    icons: Array.isArray(head?.icons) ? [...head.icons] : [0, 0, 0, 0, 0],
    timeTicks: head?.timeTicks ?? null,
    time: head?.time ?? null,
    gameVersion: text(head?.gameVersion),
    shortDesc: text(head?.shortDesc),
    author: text(head?.author),
    customVersion: text(head?.customVersion),
    properties: (Array.isArray(head?.properties) ? head.properties : [])
      .map((prop: any) => ({ key: text(prop?.key), value: text(prop?.value) })),
    desc: text(head?.desc),
  }
}

/** 换一份蓝图: 解析结果整份拷成蓝图对象，头部再单独拷一份给界面 */
function setBlueprint(parsed: Record<string, any> | null) {
  if (!parsed) {
    factory.blueprint = null
    Object.assign(factory.header, emptyHeader())
    return
  }

  factory.blueprint = markRaw(structuredClone(parsed) as FactoryBlueprint)
  // 用于界面显示与编辑
  Object.assign(factory.header, copyHeader(factory.blueprint.header))
}

/** 按建筑 id 聚合出设施清单 */
function collectFacilities(): FactoryFacility[] {
  const buildings = factory.blueprint?.buildings
  if (!Array.isArray(buildings)) return []

  // 顺序: 按 id 首次出现在建筑数组里的先后，不排序
  const counts = new Map<number, number>()
  for (const building of buildings) {
    const itemId = Number(building?.itemId)
    if (!Number.isInteger(itemId)) continue
    counts.set(itemId, (counts.get(itemId) ?? 0) + 1)
  }

  // 地基也算设施里的一项，但建筑总数只数 buildings；
  // 它在扫完建筑之后才补进去，所以蓝图里没有地基建筑时排在最后
  const reformCount = Number(factory.blueprint?.reformData?.reformCount) || 0
  if (reformCount > 0) counts.set(FOUNDATION_ITEM_ID, (counts.get(FOUNDATION_ITEM_ID) ?? 0) + reformCount)

  return [...counts.entries()].map(([itemId, count]) => ({
    itemId,
    name: itemName(itemId),
    count,
  }))
}

/** 地基在设施清单里用的物品 id */
const FOUNDATION_ITEM_ID = 1131

// ─────────────────────────────────────────────────────────────
// 派生数据
// ─────────────────────────────────────────────────────────────

/** 是否已经打开蓝图 */
export const hasBlueprint = computed(() => !!factory.blueprint)

/** 蓝图存放路径: 原文件名（句柄给的），没有句柄（粘贴导入）就是「导入的蓝图」 */
export const pathText = computed(() => {
  if (!hasBlueprint.value) return ''
  return factory.fileHandle?.name || '导入的蓝图'
})

/** 包含的设施 */
export const facilities = computed(() => collectFacilities())
/** 建筑总数 */
export const buildingCount = computed(() => {
  const buildings = factory.blueprint?.buildings
  return Array.isArray(buildings) ? buildings.length : 0
})

/** 地基总数 = 所有矩形的 w*h 之和 */
export const foundationTotal = computed(() => Number(factory.blueprint?.reformData?.reformCount) || 0)
/** 无装饰地基数 */
export const foundationUndecal = computed(() => Number(factory.blueprint?.reformData?.undecalReformCount) || 0)
/** 带装饰地基 = 总数 - 无装饰 */
export const foundationDecal = computed(() => foundationTotal.value - foundationUndecal.value)
/** 有地基才显示这一块 */
export const hasFoundation = computed(() => foundationTotal.value > 0)

// ─────────────────────────────────────────────────────────────
// 各项上限
// ─────────────────────────────────────────────────────────────

/**
 * 界面上各项的上限，
 * 输入框会按它把超出的输入吞掉
 */
export const LIMITS = {
  /** 缩略图文字 */
  shortDesc: 60,
  /** 作者 */
  author: 60,
  /** 版本 */
  customVersion: 20,
  /** 蓝图介绍 */
  desc: 2000,
  /** 属性条数 */
  properties: 20,
  /** 属性名 */
  propertyKey: 40,
  /** 属性值（本地 414 份蓝图里最长的正好 60） */
  propertyValue: 60,
} as const

/** 是否被改过: 界面那份头部与蓝图里那份（导入时 / 上次保存后的样子）整份比，两边字段顺序一致，直接序列化 */
export const metaDirty = computed(() => {
  const saved = factory.blueprint?.header
  return !!saved && JSON.stringify(factory.header) !== JSON.stringify(saved)
})

// ─────────────────────────────────────────────────────────────
// 动作
// ─────────────────────────────────────────────────────────────

/** 打开「打开蓝图」弹窗 */
export function openBlueprintModal() {
  factory.showOpenModal = true
}

/** 关闭「打开蓝图」弹窗 */
export function closeBlueprintModal() {
  factory.showOpenModal = false
}

/** 记录原文件句柄；markRaw: 代理后调它的方法（createWritable…）会报 Illegal invocation */
function setFileHandle(handle: FileSystemFileHandle | null) {
  factory.fileHandle = handle ? markRaw(handle) : null
}

/** 导入蓝图字符串；handle 是来源文件句柄（粘贴导入留空），解析失败就不动它 */
export async function loadBlueprintText(
  raw: string,
  handle: FileSystemFileHandle | null = null,
): Promise<{ ok: boolean, message: string }> {
  const value = (raw || '').trim()
  if (!value) return { ok: false, message: '蓝图内容是空的' }

  factory.parsing = true
  try {
    const parsed = await parseBlueprintString(value)
    setBlueprint(parsed)
    setFileHandle(handle)
    return { ok: true, message: handle ? `已打开蓝图：${handle.name}` : '已打开导入的蓝图' }
  } catch (error) {
    return { ok: false, message: `无法解析蓝图：${(error as Error).message}` }
  } finally {
    factory.parsing = false
  }
}

/** 导入蓝图文件（.txt）；有句柄就给句柄，只拿得到 File（浏览器没有那个 API）就给 File */
export async function loadBlueprintFile(
  source: File | FileSystemFileHandle,
): Promise<{ ok: boolean, message: string }> {
  const handle = source instanceof File ? null : source
  let content: string
  try {
    const file = source instanceof File ? source : await source.getFile()
    content = await file.text()
  } catch {
    return { ok: false, message: '读取文件失败' }
  }
  return loadBlueprintText(content, handle)
}

/** 关闭蓝图: 清空当前蓝图与信息 */
export function closeBlueprint() {
  factory.parsing = false
  setFileHandle(null)
  setBlueprint(null)
}

// ─────────────────────────────────────────────────────────────
// 复制 / 保存
// ─────────────────────────────────────────────────────────────

/** 把当前内容编码回蓝图字符串 */
async function serialize(): Promise<{ text: string, error: string }> {
  const blueprint = factory.blueprint
  if (!blueprint) return { text: '', error: '当前没有已打开的蓝图' }
  try {
    // 建筑用纯数据那份，头部用界面那份；不写回 blueprint，「复制」才不会把「已修改」清掉
    return { text: await stringifyBlueprint({ ...blueprint, header: copyHeader(factory.header) }), error: '' }
  } catch (error) {
    return { text: '', error: (error as Error).message }
  }
}

/** 复制蓝图到剪贴板 */
export async function copyBlueprint(): Promise<{ ok: boolean, message: string }> {
  const { text, error } = await serialize()
  if (error) return { ok: false, message: error }
  try {
    await navigator.clipboard.writeText(text)
    return { ok: true, message: '已复制蓝图到剪贴板' }
  } catch (err) {
    return { ok: false, message: `复制蓝图失败：${(err as Error).message}` }
  }
}

/**
 * 保存蓝图到文件: ，默认开在原文件所在目录（没有原文件就下载文件夹），
 * 保存成功后记住新句柄；没有那个 API 的浏览器退化成下载，取消不算失败（message 为空）
 */
export async function saveBlueprintFile(): Promise<{ ok: boolean, message: string }> {
  const { text, error } = await serialize()
  if (error) return { ok: false, message: error }

  const handle = factory.fileHandle

  const saved = await saveAsText(text, {
    suggestedName: handle?.name || '蓝图.txt',
    // 打开过文件就把对话框开在原文件所在目录（startIn 接受文件句柄）；没有就开在下载文件夹
    startIn: handle ?? 'downloads',
    types: [{ description: '蓝图文件', accept: { 'text/plain': ['.txt'] } }],
  })
  if (saved.error) return { ok: false, message: `保存失败：${saved.error}` }
  if (saved.canceled) return { ok: true, message: '' } // 取消保存不算失败

  markSaved(saved.handle)
  return saved.handle
    ? { ok: true, message: `已保存到 ${saved.handle.name}` }
    : { ok: true, message: '这个浏览器不能直接写文件，已改为下载' }
}

/** 保存成功后把刚写出去的内容当成新基准（头部取界面那份），「已修改」跟着清掉 */
function markSaved(handle: FileSystemFileHandle | null) {
  const blueprint = factory.blueprint
  if (blueprint) factory.blueprint = markRaw({ ...blueprint, header: copyHeader(factory.header) })
  setFileHandle(handle)
}
