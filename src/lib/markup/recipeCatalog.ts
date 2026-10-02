import type { IconCategories, IconRef } from './itemIcons.ts'
import { recipeIdsOfType, recipeTypeOfBuilding } from '../blueprint/factory/factoryRecipes.js'
import { recipeName, recipePage } from '../blueprint/factory/factoryRecipes.js'

/**
 * 配方库: 把配方按游戏配方选择窗的两个分类（物品 / 建筑）分组，供配方选择器显示
 *
 * 配方图标 id = 20000 + 配方id（见 markup/recipeIconProducts.ts）。
 */

/** 配方 id 段 → 图标 id */
const RECIPE_ICON_BASE = 20000

/** 选择窗里的页 → 分类名 */
const PAGE_NAMES: Record<number, string> = { 1: '物品', 2: '建筑' }

/** 一个配方项: 图标 id 按配方图标口径算，名字取配方名，recipeId 供调用方直接用 */
function recipeEntry(recipeId: number): IconRef {
  return {
    id: RECIPE_ICON_BASE + recipeId,
    name: recipeName(recipeId) || `#${recipeId}`,
    recipeId,
  }
}

/** 按游戏选择窗的页分组；单页的建筑只会得到一个分类（选择器那时不显示分类按钮） */
function groupByPage(recipeIds: number[]): IconCategories {
  const groups = new Map<number, IconRef[]>()
  for (const recipeId of recipeIds) {
    const page = recipePage(recipeId)
    const list = groups.get(page)
    if (list) list.push(recipeEntry(recipeId))
    else groups.set(page, [recipeEntry(recipeId)])
  }

  // 已知的两页按固定顺序在前，页号对不上的（改版 / MOD）排在后面
  const out: IconCategories = {}
  for (const page of [1, 2]) {
    const items = groups.get(page)
    if (items) {
      out[PAGE_NAMES[page]] = items
      groups.delete(page)
    }
  }
  for (const [page, items] of groups) out[`第 ${page} 页`] = items
  return out
}

/** 某类配方按选择窗的分页分组（类型是游戏 ERecipeType 的数值，见 RECIPE_TYPES） */
export function recipeCategoriesOfType(typeId: number): IconCategories {
  const ids = recipeIdsOfType(typeId)
  return ids.length ? groupByPage(ids) : {}
}

/**
 * 这栋建筑能选的配方分类（按游戏的物品 / 建筑两分类；只有一类时选择器不显示分类按钮）。
 * 不指定配方的建筑（传送带等）给空对象。
 */
export function recipeCategoriesForBuilding(itemId: number): IconCategories {
  const typeId = recipeTypeOfBuilding(itemId)
  if (!typeId) return {}
  return recipeCategoriesOfType(typeId)
}
