import { itemIconIds } from './itemIcons.ts'
import type { IconCategories, IconRef } from './itemIcons.ts'
import { iconMarkupOf, tagInfoOf } from './itemTags.ts'

/**
 * 图标库: 把 itemIcons 里的图标按 id 段分类。
 * 
 * （信号 <1000、物品 1000~9999（建筑 2000~4999）、矿脉 12000~19999、配方 20000~39999、
 * 科技 40000~41999、升级 42000~59999）
 */

const CATEGORY_BANDS: { name: string, match: (id: number) => boolean }[] = [
  { name: '信号', match: (id) => id < 1000 },
  { name: '矿脉', match: (id) => id >= 12000 && id < 20000 },
  { name: '物品', match: (id) => id >= 1000 && id < 12000 },
  { name: '建筑', match: (id) => id >= 2000 && id < 5000 },
  { name: '配方', match: (id) => id >= 20000 && id < 40000 },
  { name: '科技', match: (id) => id >= 40000 && id < 42000 },
  { name: '升级', match: (id) => id >= 42000 && id < 60000 },
]

/** 某个图标属于哪个分类：按段位从后往前找 */
function categoryNameOf(id: number): string {
  for (let i = CATEGORY_BANDS.length - 1; i >= 0; i -= 1) {
    if (CATEGORY_BANDS[i].match(id)) return CATEGORY_BANDS[i].name
  }
  return ''
}

/** 图标分类清单: 按 id 段分（分类顺序同 CATEGORY_BANDS） */
export const ICON_CATEGORIES: IconCategories = (() => {
  const out: IconCategories = {}
  for (const band of CATEGORY_BANDS) out[band.name] = []
  for (const id of itemIconIds) {
    const name = categoryNameOf(id)
    if (!name) continue
    const hit = tagInfoOf(id)
    const markup = iconMarkupOf(id)
    out[name].push({
      id,
      name: hit?.name || `#${id}`,
      ...(markup ? { markup } : {}),
    })
  }
  return out
})()

/** 按分类名取图标；分类名不认识给空数组 */
export function filterIcons(category: string): IconRef[] {
  return ICON_CATEGORIES[category] ?? []
}
