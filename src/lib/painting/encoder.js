/**
 * encoder.js — 采样色 → 蓝图涂色数据（fillGrid.colors）
 */

/** 普通涂色的满强度 a 值 */
export const PAINT_A_FULL = 127

/** 「限制颜色数量」的挡位，界面与编码器共用 */
export const MAX_COLORS_STOPS = [16, 64, 256, 1024, 2048, 0]

// 亮度权重（感知近似），用于挑最接近的保留色
const W_R = 0.299
const W_G = 0.587
const W_B = 0.114

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
 * 中位切分（median cut）: 把「每种颜色 → 用了多少格」切成 n 个盒子，每盒取加权平均色
 *
 * @param {Array<{key:number,r:number,g:number,b:number,n:number}>} list
 * @param {number} n 目标盒数
 * @returns {Array<{r:number,g:number,b:number}>}
 */
function medianCut(list, n) {
  const makeBox = (items) => {
    let rMin = 255; let rMax = 0; let gMin = 255; let gMax = 0; let bMin = 255; let bMax = 0; let total = 0;
    for (const c of items) {
      if (c.r < rMin) rMin = c.r
      if (c.r > rMax) rMax = c.r
      if (c.g < gMin) gMin = c.g
      if (c.g > gMax) gMax = c.g
      if (c.b < bMin) bMin = c.b
      if (c.b > bMax) bMax = c.b
      total += c.n
    }
    return {
      items, total, rMin, rMax, gMin, gMax, bMin, bMax,
      range: Math.max(rMax - rMin, gMax - gMin, bMax - bMin),
    }
  }

  const boxes = [makeBox(list)]
  while (boxes.length < n) {
    // 选「跨度大 × 格子多」的盒子先切
    let bi = -1
    let bestScore = -1
    for (let i = 0; i < boxes.length; i += 1) {
      const b = boxes[i]
      if (b.items.length < 2) continue
      const score = b.range * Math.sqrt(b.total)
      if (score > bestScore) { bestScore = score; bi = i }
    }
    if (bi < 0) break // 剩下的盒子都只有一种颜色，切不动了

    const b = boxes[bi]
    const dr = b.rMax - b.rMin
    const dg = b.gMax - b.gMin
    const db = b.bMax - b.bMin
    const ch = dr >= dg && dr >= db ? 'r' : dg >= db ? 'g' : 'b'
    b.items.sort((x, y) => x[ch] - y[ch])

    // 在「格子数」的中位处切开（不是颜色种数的中点）
    const half = b.total / 2
    let acc = 0
    let cut = 1
    for (let i = 0; i < b.items.length; i += 1) {
      acc += b.items[i].n
      if (acc >= half) { cut = i + 1; break }
    }
    if (cut < 1) cut = 1
    if (cut > b.items.length - 1) cut = b.items.length - 1

    boxes.splice(bi, 1, makeBox(b.items.slice(0, cut)), makeBox(b.items.slice(cut)))
  }

  return boxes.map((b) => {
    let sr = 0; let sg = 0; let sb = 0
    for (const c of b.items) { sr += c.r * c.n; sg += c.g * c.n; sb += c.b * c.n }
    return {
      r: Math.round(sr / b.total),
      g: Math.round(sg / b.total),
      b: Math.round(sb / b.total),
    }
  })
}

/**
 * 采样结果 → 蓝图涂色数据
 * @param {Array<{r:number,g:number,b:number,a:number}|null>} samples 每格的采样色（null/a<=0 = 不涂色）
 * @param {{maxColors?:number}} [opts] maxColors: 限制用色数量（0 = 不限制）
 * @returns {{ colors: Array<{r:number,g:number,b:number,a:number}>, stats: object }}
 */
export function encodeGrid(samples, opts = {}) {
  const maxColors = Math.max(0, opts.maxColors || 0)

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

  // 限制颜色数量: 中位切分得到 maxColors 种代表色，其余颜色改用最接近的代表色
  if (maxColors > 0 && counts.size > maxColors) {
    const list = []
    for (const [key, cnt] of counts) {
      list.push({ key, r: (key >> 16) & 0xff, g: (key >> 8) & 0xff, b: key & 0xff, n: cnt })
    }
    const reps = medianCut(list, maxColors)

    // 每种颜色 → 最接近的代表色（在「不同颜色」上搜索，不是每格都搜一遍）
    const assign = new Map()
    for (const c of list) {
      let best = reps[0]
      let bestD = Infinity
      for (const p of reps) {
        const dr = c.r - p.r
        const dg = c.g - p.g
        const db = c.b - p.b
        const d = W_R * dr * dr + W_G * dg * dg + W_B * db * db
        if (d < bestD) { bestD = d; best = p }
      }
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
