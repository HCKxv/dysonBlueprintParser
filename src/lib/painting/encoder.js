/**
 * encoder.js — 采样色 → 蓝图涂色数据（fillGrid.colors）
 *
 * 调色板量化算法见 quantizeAlgorithms.js:
 *   median = 中位切分（默认） / oklab = OKLab + K-means++（随机种子决定初始中心）
 */

import { buildPalette, metricOf, nearestPaletteIndex } from './quantizeAlgorithms.js'

/** 普通涂色的满强度 a 值 */
export const PAINT_A_FULL = 127

/** 「限制颜色数量」的挡位，界面与编码器共用 */
export const MAX_COLORS_STOPS = [16, 64, 256, 1024, 2048, 0]

/** 地基彩绘固定用色数: 地基蓝图每格只有 5 位色号，正好对应 16 个自定义色槽 */
export const FOUNDATION_COLOR_COUNT = 16

/** 地基彩绘里「这一格不铺」的色号 */
export const FOUNDATION_NO_COLOR = 255

/**
 * 采样色 → 32 位压缩色（地基采样用）
 * 高 24 位 RGB、低 8 位只表示「有没有颜色」（0 由调用方用作「不铺」）
 */
export function packSample(r, g, b) {
  return (((r & 0xff) << 24) | ((g & 0xff) << 16) | ((b & 0xff) << 8) | 0xff) >>> 0
}

function packColor(r, g, b, a) {
  return ((r & 0xff) << 24) | ((g & 0xff) << 16) | ((b & 0xff) << 8) | (a & 0xff)
}

/** 32 位打包色 → { r, g, b, a } */
function unpackColor(packed) {
  return {
    r: (packed >>> 24) & 0xff,
    g: (packed >>> 16) & 0xff,
    b: (packed >>> 8) & 0xff,
    a: packed & 0xff,
  }
}

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v))

/**
 * 采样结果 → 蓝图涂色数据
 * @param {Array<{r:number,g:number,b:number,a:number}|null>} samples 每格的采样色（null/a<=0 = 不涂色）
 * @param {{maxColors?:number, method?:string, seed?:number}} [opts]
 *   maxColors: 限制用色数量（0 = 不限制）；method: 量化算法（median / oklab）；seed: K-means++ 的随机种子
 * @returns {{ colors: Array<{r:number,g:number,b:number,a:number}>, stats: object }}
 */
export function encodeGrid(samples, opts = {}) {
  const maxColors = Math.max(0, opts.maxColors || 0)
  const method = metricOf(opts.method) // 归色度量跟着算法走

  const total = samples.length
  const packed = new Int32Array(total) // 0 = 未涂色
  const counts = new Map() // RGB key → 格子数
  let paintedCells = 0

  for (let i = 0; i < total; i += 1) {
    const s = samples[i]
    if (!s || s.a <= 0) continue
    const r = clamp255(s.r)
    const g = clamp255(s.g)
    const b = clamp255(s.b)
    packed[i] = packColor(r, g, b, PAINT_A_FULL)
    const key = (r << 16) | (g << 8) | b
    counts.set(key, (counts.get(key) || 0) + 1)
    paintedCells += 1
  }

  let usedColors = counts.size

  // 限制颜色数量: 按选定算法（中位切分 / OKLab + K-means++）取 maxColors 种代表色，其余颜色改用最接近的代表色
  if (maxColors > 0 && counts.size > maxColors) {
    const list = []
    for (const [key, cnt] of counts) {
      list.push({ key, r: (key >> 16) & 0xff, g: (key >> 8) & 0xff, b: key & 0xff, n: cnt })
    }
    const reps = buildPalette(list, maxColors, { method: opts.method, seed: opts.seed })

    // 每种颜色 → 最接近的代表色（在「不同颜色」上搜索，不是每格都搜一遍）
    const assign = new Map()
    for (const c of list) {
      const best = reps[nearestPaletteIndex(c.r, c.g, c.b, reps, method)]
      assign.set(c.key, (best.r << 16) | (best.g << 8) | best.b)
    }

    // 按格替换（同一颜色查一次表）
    const used = new Set()
    for (let i = 0; i < total; i += 1) {
      const p = packed[i]
      if (!p) continue
      const key = (((p >>> 24) & 0xff) << 16) | (((p >>> 16) & 0xff) << 8) | ((p >>> 8) & 0xff)
      const rk = assign.get(key)
      used.add(rk)
      if (rk === key) continue
      packed[i] = packColor((rk >> 16) & 0xff, (rk >> 8) & 0xff, rk & 0xff, PAINT_A_FULL)
    }
    usedColors = used.size
  }

  const colors = new Array(total)
  for (let i = 0; i < total; i += 1) {
    colors[i] = packed[i] ? unpackColor(packed[i]) : { r: 0, g: 0, b: 0, a: 0 }
  }

  return {
    colors,
    stats: { total, painted: paintedCells, colorsUsed: usedColors },
  }
}

/**
 * 采样结果 → 调色板 + 每格色号（地基彩绘）
 *
 * 与 encodeGrid 的区别: 戴森球涂色是每格一个 RGBA、直接写进蓝图；
 * 地基蓝图是「一张最多 16 色的调色板 + 每格 5 位色号」，所以这里输出编号而不是颜色本身。
 *
 * @param {Uint32Array|number[]} packed packSample 的压缩色（0 = 不铺地基）
 * @param {{maxColors?:number, method?:string, seed?:number}} [opts]
 *   maxColors: 调色板最多几种颜色（地基固定 16）；method: 量化算法；seed: K-means++ 随机种子
 * @returns {{palette:Array<{r:number,g:number,b:number}>, index:Uint8Array,
 *            stats:{total:number,painted:number,colorsUsed:number}}}
 *   index: FOUNDATION_NO_COLOR(255) = 不铺地基，其余 = palette 下标
 */
export function encodeIndexed(packed, opts = {}) {
  const maxColors = Math.max(1, Math.min(255, Math.trunc(opts.maxColors) || FOUNDATION_COLOR_COUNT))
  const total = packed.length
  const metric = metricOf(opts.method) // 归色度量跟着算法走

  // 1) 统计每种颜色用了多少格
  const counts = new Map()
  let painted = 0
  for (let i = 0; i < total; i += 1) {
    const p = packed[i]
    if (!p) continue
    painted += 1
    const key = p >>> 8
    counts.set(key, (counts.get(key) || 0) + 1)
  }

  const list = []
  for (const [key, n] of counts) {
    list.push({ key, r: (key >>> 16) & 0xff, g: (key >>> 8) & 0xff, b: key & 0xff, n })
  }

  // 2) 调色板: 颜色本来就够少就原样用，否则按选定算法取 maxColors 种代表色
  //    地基只有 16 个色位，再加一道「合并过于相近的颜色」，别让两个几乎一样的颜色各占一个位置
  const palette = buildPalette(list, maxColors, { method: opts.method, seed: opts.seed, mergeNear: true })

  // 3) 每种颜色 → 最接近的代表色下标（在「不同颜色」上搜索，不是每格都搜一遍）
  const assign = new Map()
  for (const c of list) {
    assign.set(c.key, nearestPaletteIndex(c.r, c.g, c.b, palette, metric))
  }

  // 4) 逐格写色号
  const index = new Uint8Array(total).fill(FOUNDATION_NO_COLOR)
  const used = new Uint8Array(palette.length)
  for (let i = 0; i < total; i += 1) {
    const p = packed[i]
    if (!p) continue
    const ci = assign.get(p >>> 8)
    index[i] = ci
    used[ci] = 1
  }

  // 5) 压缩调色板: 中位切分出的代表色可能一个格子都没分到，去掉它们再重编号
  let paletteSize = 0
  for (let i = 0; i < palette.length; i += 1) if (used[i]) paletteSize += 1
  let finalPalette = palette
  if (paletteSize !== palette.length) {
    const remap = new Int16Array(palette.length).fill(-1)
    finalPalette = []
    for (let i = 0; i < palette.length; i += 1) {
      if (!used[i]) continue
      remap[i] = finalPalette.length
      finalPalette.push(palette[i])
    }
    for (let i = 0; i < total; i += 1) {
      const ci = index[i]
      if (ci !== FOUNDATION_NO_COLOR) index[i] = remap[ci]
    }
  }

  return {
    palette: finalPalette,
    index,
    stats: { total, painted, colorsUsed: finalPalette.length },
  }
}
