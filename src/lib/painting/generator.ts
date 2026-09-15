/**
 * generator.ts — 彩绘生成: 输入图片 → 涂色网格数据（fillGrid）
 *
 * 流程:
 *   1. 载入图片
 *   2. projection.createProjector 把球面坐标映射到图片 UV，按格子采样颜色（经纬线网格）
 *   3. encoder 把采样色编码成蓝图里的 RGBA（a = 笔刷强度，满强度普通涂色）
 *   4. 生成 { gridType: 0, colors }，可直接交给
 *      - 预览: paintingGrid.buildPaintingGeometry（只渲染已涂色的壳面格子）
 *      - 导出: 写入基底蓝图的 fillGrid
 *
 */

import { createProjector, detectImageBackground } from './projection.js'
import { encodeGrid } from './encoder.js'

/** 蓝图里的涂色数据（与 blueprintParser 输出一致） */
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
  /** 本次实际使用的填充色（「图片背景色」模式下 = 检测结果） */
  fillColor: string
}

/** 载入图片（优先用同一张已载入过的 URL，避免重复解码） */
const imageCache = new Map<string, Promise<HTMLImageElement>>()

export function loadImage(src: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(src)
  if (cached) return cached
  const p = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => {
      imageCache.delete(src)
      reject(new Error('图片载入失败'))
    }
    img.src = src
  })
  imageCache.set(src, p)
  return p
}

/** 填充色来源 → 实际颜色 */
export function resolveFillColor(params: any, img?: HTMLImageElement): string {
  switch (params?.fillMode) {
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

  // 0) 解析填充色
  const fillColor = resolveFillColor(params, img)

  // 1) 采样：每个格子取图片颜色（经纬线网格，颜色数组下标 = 游戏格子序号）
  const projector = createProjector(img, { ...params, fillColor })
  const t1 = performance.now()
  const samples = projector.sampleCells()
  const t2 = performance.now()

  // 2) 编码成蓝图 RGBA
  const { colors, stats } = encodeGrid(samples, { maxColors: params.maxColors })
  const t3 = performance.now()

  return {
    fillGrid: { gridType: 0, colors },
    fillColor,
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
