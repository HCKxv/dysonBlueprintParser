/**
 * generator.ts — 彩绘生成: 输入图片 → 涂色网格数据（fillGrid）
 *
 * 流程:
 *   1. 载入图片
 *   2. projection.createProjector 把球面坐标映射到图片 UV，按格子采样颜色（经纬线网格）
 *   3. encoder 把采样色编码成蓝图里的 RGBA（a = 笔刷强度，满强度普通涂色）
 *   4. 生成 { gridType: 0, colors }，可直接交给
 *      - 预览: paintingGrid.buildGraticuleGeometry（只渲染已涂色的壳面格子）
 *      - 导出: 写入基底蓝图的 fillGrid
 *
 */

import { createProjector, detectImageBackground } from './projection.js'
import { encodeGrid, encodeIndexed, FOUNDATION_COLOR_COUNT } from './encoder.js'
import { loadImage } from './imageLoader.js'

/** 蓝图里的涂色数据（与 parseBlueprintString 输出一致） */
export interface FillGrid {
  gridType: number
  colors: Array<{ r: number; g: number; b: number; a: number }> | null
}

export interface PaintStats {
  /** 网格格子 / 三角形总数 */
  total: number
  /** 已涂色格子数 */
  painted: number
  /** 实际用到的涂色颜色数 */
  colorsUsed: number
  /** 采样耗时（ms） */
  sampleMs: number
  /** 编码耗时（ms） */
  encodeMs: number
  /** 总耗时（ms） */
  totalMs: number
}

export interface PaintResult {
  fillGrid: FillGrid
  stats: PaintStats
}

/** 地基彩绘数据: 一张调色板 + 每格一个色号（255 = 不铺地基） */
export interface FoundationPaint {
  palette: Array<{ r: number; g: number; b: number }>
  index: Uint8Array
}

export interface FoundationResult {
  paint: FoundationPaint
  stats: PaintStats
}

/** 底色来源 → 实际颜色；null = 没有底色 */
function resolveFillColor(params: any, img?: HTMLImageElement): string | null {
  switch (params?.fillMode) {
    case 'none': return null
    case 'white': return '#ffffff'
    case 'bg': return (img && detectImageBackground(img)) || '#000000'
    case 'custom': return params?.fillColor || '#000000'
    case 'black':
    default: return '#000000'
  }
}

/**
 * 生成涂色网格数据
 * @param params stores/painting.ts 的 painting 对象
 * @returns 涂色数据 + 统计
 */
export async function generateFillGrid(params: any): Promise<PaintResult> {
  if (!params?.imageUrl) throw new Error('请先载入图片')

  const t0 = performance.now()
  const img = await loadImage(params.imageUrl)

  // 0) 解析底色
  const fillColor = resolveFillColor(params, img)

  // 1) 采样：每个格子取图片颜色（经纬线网格，颜色数组下标 = 游戏格子序号）
  const projector = createProjector(img, { ...params, fillColor })
  const t1 = performance.now()
  const samples = projector.sampleCells()
  const t2 = performance.now()

  // 2) 编码成蓝图 RGBA（量化算法与随机种子来自参数）
  const { colors, stats } = encodeGrid(samples, {
    maxColors: params.maxColors,
    method: params.quantizeMethod,
    seed: params.quantizeSeed,
  })
  const t3 = performance.now()

  return {
    fillGrid: { gridType: 0, colors },
    stats: {
      total: stats.total,
      painted: stats.painted,
      colorsUsed: stats.colorsUsed,
      sampleMs: Math.round(t2 - t1),
      encodeMs: Math.round(t3 - t2),
      totalMs: Math.round(t3 - t0),
    },
  }
}

/**
 * 生成地基彩绘数据（图片 → 行星地基网格的每格颜色）
 *
 * 与戴森球那条的区别:
 *   - 网格是行星地基网格（32 万格，见 lib/grid/planetGrid.js），不是壳面涂色网格
 *   - 颜色固定量化成 FOUNDATION_COLOR_COUNT(16) 种，输出「调色板 + 每格色号」
 *
 * @param {any} params stores/painting.ts 的 painting 对象
 * @param {any} grid createPlanetGrid() 的结果
 * @returns {Promise<FoundationResult>} 地基彩绘数据 + 统计
 */
export async function generateFoundationPaint(params: any, grid: any): Promise<FoundationResult> {
  if (!params?.imageUrl) throw new Error('请先载入图片')
  if (!grid?.total) throw new Error('行星地基网格无效')

  const t0 = performance.now()
  const img = await loadImage(params.imageUrl)

  // 0) 解析底色
  const fillColor = resolveFillColor(params, img)

  // 1) 采样: 每个格子取格内的点（行星网格比戴森球密，见 projection.js 的档位）
  const projector = createProjector(img, { ...params, fillColor })
  const t1 = performance.now()
  const samples = projector.samplePlanetGrid(grid)
  const t2 = performance.now()

  // 2) 量化成 16 色调色板 + 每格色号（中位切分 / OKLab + K-means++）
  const { palette, index, stats } = encodeIndexed(samples, {
    maxColors: FOUNDATION_COLOR_COUNT,
    method: params.quantizeMethod,
    seed: params.quantizeSeed,
  })
  const t3 = performance.now()

  return {
    paint: { palette, index },
    stats: {
      total: stats.total,
      painted: stats.painted,
      colorsUsed: stats.colorsUsed,
      sampleMs: Math.round(t2 - t1),
      encodeMs: Math.round(t3 - t2),
      totalMs: Math.round(t3 - t0),
    },
  }
}
