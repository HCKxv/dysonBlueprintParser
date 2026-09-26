import { itemIconIds } from './itemIcons.ts'
import { iconMarkupOf, tagInfoOf } from './itemTags.ts'

/**
 * 图标清单（图标选择器用）: 名字取标记表里的中文名，没有就退回 `#id`；分类按 id 段判
 * （信号 <1000、物品 1000~9999（建筑 2000~4999）、矿脉 12000~19999、配方 20000~39999、
 * 科技 40000~41999、升级 42000~59999）
 */

export interface IconCategory {
  id: string
  label: string
}

export const ICON_CATEGORIES: IconCategory[] = [
  { id: 'all', label: '全部' },
  { id: 'signal', label: '信号' },
  { id: 'vein', label: '矿脉' },
  { id: 'item', label: '物品' },
  { id: 'building', label: '建筑' },
  { id: 'recipe', label: '配方' },
  { id: 'tech', label: '科技' },
  { id: 'upgrade', label: '升级' },
]

export interface IconEntry {
  id: number
  /** 显示名 */
  name: string
  /** 完整标记 `\tiek;`；没有标记给空串（提示文字用） */
  markup: string
  category: string
}

/** 图标选择器交出去的东西 */
export interface IconRef {
  id: number
  /** 显示名（物品 / 科技名） */
  name: string
  /** 完整标记 `\tiek;`；没有标记给空串 */
  markup: string
}

/** id → 分类 id（区段见文件头） */
function categoryOf(id: number): string {
  if (id < 1000) return 'signal'
  if (id < 12000) return id >= 2000 && id < 5000 ? 'building' : 'item'
  if (id < 20000) return 'vein'
  if (id < 40000) return 'recipe'
  if (id < 42000) return 'tech'
  if (id < 60000) return 'upgrade'
  return 'all'
}

/** 全部图标（按 id 升序） */
const ICON_ENTRIES: IconEntry[] = itemIconIds.map((id) => {
  const hit = tagInfoOf(id)
  return {
    id,
    name: hit?.name || `#${id}`,
    markup: iconMarkupOf(id),
    category: categoryOf(id),
  }
})

/** 按分类过滤 */
export function filterIcons(category: string): IconEntry[] {
  const cat = ICON_CATEGORIES.find((c) => c.id === category) ?? ICON_CATEGORIES[0]
  return cat.id === 'all' ? ICON_ENTRIES : ICON_ENTRIES.filter((entry) => entry.category === cat.id)
}
