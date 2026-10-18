import { computed, markRaw, reactive, ref, watch } from 'vue'
import { parseBlueprintString } from '../lib/blueprint/factory/factoryParser.js'
import { stringifyBlueprint } from '../lib/blueprint/factory/factoryEncoder.js'
import { itemName, isStation } from '../lib/blueprint/factory/factoryItems.js'
import { applyBatchRules, syncBeltIcon } from '../lib/factory/batch.js'
import { ITEM_MODEL } from '../lib/factory/buildingModels.js';
import type { FactoryPreview } from '../lib/factory/FactoryPreview.js'
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

/** 一条批量编辑规则 */
export interface BatchRule {
  type: string
  options: Record<string, any>
}

export const factory = reactive({
  /** 正在解析 */
  parsing: false,
  /** 完整蓝图数据 */
  blueprint: null as FactoryBlueprint | null,
  /** 头部: 用于显示和编辑 */
  header: reactive(emptyHeader()),
  /** 预览里选中的建筑编号（building.index），没选中 = null */
  selectedIndex: null as number | null,
  /** 当前蓝图对应的原文件句柄（File System Access API） */
  fileHandle: null as FileSystemFileHandle | null,
  /** 原始蓝图字符串 */
  raw: '',
  /** 主体改过没有 */
  modified: false,
})

/** 「打开蓝图」弹窗 */
export const showOpenModal = ref(false)

/** 批量编辑，见 lib/factory/batch.js 的规则类型表 */
export const batchRules = ref<BatchRule[]>([])

/** 左侧输入栏的三档: 信息/ 详情/ 批量编辑 */
export type FactoryViewId = 'info' | 'detail' | 'batch'

/** 当前显示的档位 */
export const factoryView = ref<FactoryViewId>('info')

// 选中 / 取消选中时自动切
watch(() => factory.selectedIndex, (index) => {
  if (index !== null) {
    factoryView.value = 'detail'
    return
  }
  if (factoryView.value === 'detail') factoryView.value = 'info'
})

/** 3D 预览实例 */
let preview: FactoryPreview | null = null

/** 挂上 / 摘掉预览实例 */
export function attachPreview(instance: FactoryPreview | null) {
  preview = instance
  if (!preview) {
    factory.selectedIndex = null   // 场景没了，选中也就不存在了
    return
  }
  preview.setSelectionListener((index) => { factory.selectedIndex = index })
  preview.setBlueprint(factory.blueprint);
}

// 选中编号同步给场景
watch(() => factory.selectedIndex, (index) => {
  preview?.selectBuilding(index)
})

/**
 * 换一份蓝图 → 让预览重摆（「蓝图 → 场景」只有这一个出口）
 *
 * @param blueprint 新蓝图
 * @param resetView 视角要不要归位
 */
function applyBlueprint(blueprint: FactoryBlueprint | null, resetView: boolean = true) {
  const selected = factory.selectedIndex

  factory.blueprint = blueprint ? markRaw({ ...blueprint }) : null
  preview?.setBlueprint(factory.blueprint, resetView)

  if (selected !== null && !resetView) {
    // 编号没变 → 上面那个 watch 不会触发，选中得自己送进场景
    factory.selectedIndex = selected
    preview?.selectBuilding(selected)
  }
}

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

/**
 * 换一份蓝图
 * @param parsed parseBlueprintString 的结果；null = 关闭蓝图
 * @param raw 原始蓝图字符串
 */
function setBlueprint(parsed: Record<string, any> | null, raw = '') {
  factory.selectedIndex = null     // 编号是蓝图内部的序号，换蓝图重新开始
  factory.raw = parsed ? raw : ''
  factory.modified = false
  factoryView.value = 'info'
  if (!parsed) {
    applyBlueprint(null)
    Object.assign(factory.header, emptyHeader())
    return
  }

  applyBlueprint(structuredClone(parsed) as FactoryBlueprint)
  // 用于界面显示与编辑
  Object.assign(factory.header, copyHeader(factory.blueprint!.header))
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

/**
 * 当前选中的建筑:编号对不上蓝图里的建筑就当没选中
 */
export const selectedBuilding = computed(() => {
  const buildings = factory.blueprint?.buildings
  const index = factory.selectedIndex
  if (!Array.isArray(buildings) || index === null) return null
  // 序号就是下标: 取回来核一下序号，对不上（越界也是 undefined）当没选中
  const building = buildings[index]
  return building && Number(building.index) === index ? building : null
})

/** 选中建筑的坐标（格） */
export const selectedBuildingCoord = computed(() => {
  const index = factory.selectedIndex
  if (index === null || !factory.blueprint) return null
  return preview?.buildingCoord(index) ?? null
})

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

/** 有没有未保存的改动 */
export const hasChanges = computed(() => {
  if (factory.modified) return true
  const saved = factory.blueprint?.header
  return !!saved && JSON.stringify(factory.header) !== JSON.stringify(saved)
})

// ─────────────────────────────────────────────────────────────
// 动作
// ─────────────────────────────────────────────────────────────

/** 打开「打开蓝图」弹窗 */
export function openBlueprintModal() {
  showOpenModal.value = true
}

/** 关闭「打开蓝图」弹窗 */
export function closeBlueprintModal() {
  showOpenModal.value = false
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
    setBlueprint(parsed, value)
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
// 编辑建筑 / 还原
// ─────────────────────────────────────────────────────────────

/** 能改的建筑字段 */
export interface BuildingChanges {
  /** 建筑 id */
  itemId?: number
  /** 模型序号 */
  modelIndex?: number
  /** 配方 id） */
  recipeId?: number
  /** 筛选物品 id */
  filterId?: number
  /** 建筑参数 */
  parameters?: Record<string, any>
  /** 建筑备注 */
  content?: string | null
}

/** 连在一起的研究站（连同它自己） */
export function linkedLabBuildings(index: number): any[] {
  const buildings = factory.blueprint?.buildings
  if (!Array.isArray(buildings)) return []

  const isLab = (id: unknown) => Number(id) === 2901 || Number(id) === 2902
  /** 序号就是下标，取回来核一下序号，对不上（越界也是 undefined）当没这栋 */
  const at = (target: unknown) => {
    const building = buildings[Number(target)]
    return building && Number(building.index) === Number(target) ? building : null
  }

  const start = at(index)
  if (!start || !isLab(start.itemId)) return []

  // 谁连到我（前驱）: 扫一遍建筑，把指向研究站的连接反过来记
  const previous = new Map<number, number[]>()
  for (const b of buildings) {
    const from = Number(b?.index)
    if (!Number.isInteger(from)) continue
    for (const target of [Number(b?.outputObjIdx), Number(b?.inputObjIdx)]) {
      const to = at(target)
      if (!to || !isLab(to.itemId)) continue
      const list = previous.get(target)
      if (list) list.push(from)
      else previous.set(target, [from])
    }
  }

  const group = [start]
  const seen = new Set([index])
  for (let i = 0; i < group.length; i += 1) {
    const b = group[i]
    const self = Number(b.index)
    const neighbours = [
      Number(b.outputObjIdx), Number(b.inputObjIdx),   // 我连出去的
      ...(previous.get(self) ?? []),                   // 连到我的
    ]
    for (const next of neighbours) {
      const other = at(next)
      if (!other || seen.has(next) || !isLab(other.itemId)) continue
      seen.add(next)
      group.push(other)
    }
  }
  return group
}

/**
 * 改一栋建筑
 * @returns 找到了并改上了 true；蓝图没打开 / 编号对不上 / 过滤后没字段 false
 */
export function editBuilding(index: number, changes: BuildingChanges): boolean {
  const blueprint = factory.blueprint
  const buildings = blueprint?.buildings
  if (!blueprint || !Array.isArray(buildings) || !changes) return false

  // 序号就是下标，对不上（坏数据）直接退出，不至于改到别人的落点上。
  const building = buildings[index]
  if (!building || Number(building.index) !== index) return false

  // 空字段（null / undefined）= 这项不改
  const edits: Record<string, any> = {}
  for (const key in changes) {
    if (changes[key] != null) edits[key] = changes[key]
  }
  if (Object.keys(edits).length === 0) return false

  buildings[index] = { ...building, ...edits }
  if (isStation(building.itemId)) syncBeltIcon(blueprint)
  
  applyBlueprint(blueprint, false)
  factory.modified = true
  return true
}

/**
 * 改「一整栋研究站」: 连同蓝图里与它相连的那些一起改
 */
export function editLabGroup(index: number, changes: BuildingChanges): boolean {
  const group = linkedLabBuildings(index)
  // 不是研究站（或没连别的）就当普通单栋改
  if (group.length <= 1) return editBuilding(index, changes)

  const before = group.map((b) => ({ index: Number(b.index), snapshot: { ...b } }))
  const done: number[] = []
  for (const b of group) {
    if (editBuilding(Number(b.index), changes)) done.push(Number(b.index))
  }
  if (done.length === group.length) return true

  // 有没改上的: 把改过的还原，不留半改状态
  for (const { index: i, snapshot } of before) {
    if (done.includes(i)) editBuilding(i, snapshot)
  }
  return false
}

/**
 * 替换物流塔: 行星内物流运输站（2103）↔ 星际物流运输站（2104）
 *
 * @param index 建筑编号
 * @param dropSlot 降回行星内时丢弃第几个物品栏位（1-5）；不给就丢最后一个
 */
export function editStationType(index: number, dropSlot: number | null = null): boolean {
  const building = factory.blueprint?.buildings[index]
  if (!building || Number(building.index) !== index) return false

  const slot = Number.isInteger(dropSlot) ? Number(dropSlot) : 5

  const parameters = { ...(building.parameters ?? {}) }

  let itemId: number
  if (building.itemId === 2103) {
    // 行星内 → 星际: 补一个空栏位
    if (parameters.storage.length <= 4) {
      parameters.storage.push({ itemId: 0, localRole: 0, remoteRole: 0, max: 0, lockAmount: 0 })
    }
    itemId = 2104
  } else if (building.itemId === 2104) {
    // 星际 → 行星内: 丢一个栏位，再把指着它的传送带槽位改掉
    parameters.storage.splice(slot - 1, 1)
    parameters.slots.forEach(belt => {
      const storageIdx = Number(belt?.storageIdx)
      if (storageIdx < 1 || storageIdx > 5) return   // 0 = 不输出、6 = 翘曲器
      if (storageIdx === slot) belt.storageIdx = 0
      else if (storageIdx > slot) belt.storageIdx = storageIdx - 1
    })
    itemId = 2103
  } else {
    return false
  }

  return editBuilding(index, { itemId, modelIndex: ITEM_MODEL[itemId]?.[0], parameters })
}

/**
 * 批量编辑: 把规则数组（batchRules）作用到当前蓝图上
 *
 * @returns ok=false 时 message 说明原因，规则数组保持原样
 */
export function applyBatchEdit(): {
  ok: boolean
  message: string
} {
  const blueprint = factory.blueprint
  if (!blueprint || !Array.isArray(blueprint.buildings)) {
    return { ok: false, message: '当前没有已打开的蓝图' }
  }

  applyBatchRules(blueprint, batchRules.value)

  // 预览按新数据重摆
  applyBlueprint(blueprint, false)
  factory.modified = true
  batchRules.value = []                       // 提交完就清空规则数组
  return { ok: true, message: '' }
}

/**
 * 还原修改
 * @returns ok=false 时 message 说明原因
 */
export async function revertBlueprint(): Promise<{ ok: boolean, message: string }> {
  const raw = factory.raw
  if (!hasBlueprint.value) return { ok: false, message: '当前没有已打开的蓝图' }
  if (!raw) return { ok: false, message: '没有可还原的原始蓝图' }

  factory.parsing = true
  try {
    const parsed = await parseBlueprintString(raw)
    setBlueprint(parsed, raw)
    return { ok: true, message: '已还原到上次打开 / 保存的样子' }
  } catch (error) {
    return { ok: false, message: `无法还原：${(error as Error).message}` }
  } finally {
    factory.parsing = false
  }
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

  markSaved(saved.handle, text)
  return saved.handle
    ? { ok: true, message: `已保存到 ${saved.handle.name}` }
    : { ok: true, message: '这个浏览器不能直接写文件，已改为下载' }
}

/** 保存成功后把刚写出去的内容当成新基准，「已修改」跟着清掉 */
function markSaved(handle: FileSystemFileHandle | null, text: string) {
  const blueprint = factory.blueprint
  // 只换了头部，建筑没动 → 不归位视角
  if (blueprint) applyBlueprint({ ...blueprint, header: copyHeader(factory.header) }, false)
  factory.raw = text
  factory.modified = false
  setFileHandle(handle)
}
