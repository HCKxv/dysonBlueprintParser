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

/** 图标 URL；没有对应图标时返回空串 */
export function itemIconUrl(itemId: number): string {
  return ICONS[itemId] ?? ''
}

/** 已提取的全部图标 id（升序，图标选择器用） */
export const itemIconIds: number[] = Object.keys(ICONS)
  .map(Number)
  .sort((a, b) => a - b)
