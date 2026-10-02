import { recipeIconProduct } from './recipeIconProducts.ts'

/** 选择器里的一项 */
export interface IconRef {
  /** 图标 id */
  id: number
  /** 显示名 */
  name: string
  /** 图标标记 `\tiek;` */
  markup?: string
  /** 配方 id */
  recipeId?: number
}

/** 分类名 → 该类下的图标 */
export type IconCategories = Record<string, IconRef[]>

/** 图标索引: 图标 id → 图片 URL */
const files = import.meta.glob('../../assets/icons/*/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

const ICONS: Record<number, string> = {}

for (const [path, url] of Object.entries(files)) {
  const id = Number(path.slice(path.lastIndexOf('/') + 1, -'.png'.length))
  if (Number.isInteger(id)) ICONS[id] = url
}

/** 图标 URL；没有对应图标时返回空串（配方图标 id 先查自带图标，再按映射表落到主产物图标） */
export function itemIconUrl(itemId: number): string {
  const url = ICONS[itemId]
  if (url) return url
  const product = recipeIconProduct(itemId)
  return product ? (ICONS[product] ?? '') : ''
}

/** 已提取的全部图标 id（升序，图标选择器用） */
export const itemIconIds: number[] = Object.keys(ICONS)
  .map(Number)
  .sort((a, b) => a - b)
