/**
 * quantizeAlgorithms.js — 调色板量化算法
 *
 * 两种算法，输入都是「颜色直方图」list = [{ r, g, b, n }]（n = 用了多少格）:
 *   median    中位切分（median cut）: 按格数中位切开、盒内加权平均取代表色
 *   oklab     OKLab + K-means++: 在 OKLab 感知空间里做加权 k-means，随机种子决定初始中心
 *
 * 归色（把每种颜色指到最近的代表色）也跟着算法走:
 *   median    → 亮度加权 RGB 距离（0.299/0.587/0.114）
 *   oklab     → OKLab 欧氏距离
 */

/** 亮度权重（感知近似） */
export const W_R = 0.299
export const W_G = 0.587
export const W_B = 0.114

/** 量化算法取值 */
const QUANTIZE_METHODS = ['median', 'oklab']

/** 把任意输入规整成合法算法名 */
function normalizeMethod(method) {
  return QUANTIZE_METHODS.includes(method) ? method : 'median'
}

/** 归色时用的距离度量（跟着算法走） */
export function metricOf(method) {
  return normalizeMethod(method) === 'oklab' ? 'oklab' : 'weighted-rgb'
}

// ─────────────────────────────────────────────────────────────
// sRGB ⇄ OKLab（Björn Ottosson 的拟合式）
// ─────────────────────────────────────────────────────────────

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v))

/** sRGB 分量（0-1，带 gamma）→ 线性 */
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
/** 线性 → sRGB 分量（0-1，带 gamma） */
const toGamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)

/**
 * sRGB(0-255) → OKLab
 * @returns {[number,number,number]} [L, a, b]（L 约 0-1，a/b 约 ±0.4）
 */
export function srgbToOklab(r, g, b) {
  const R = toLinear(r / 255)
  const G = toLinear(g / 255)
  const B = toLinear(b / 255)
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B)
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B)
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

/**
 * OKLab → sRGB(0-255)，越界分量按 0 / 255 夹住
 * @returns {[number,number,number]}
 */
export function oklabToSrgb(L, A, B) {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3
  return [
    clamp255(toGamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s) * 255),
    clamp255(toGamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s) * 255),
    clamp255(toGamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s) * 255),
  ]
}

// ─────────────────────────────────────────────────────────────
// 距离度量
// ─────────────────────────────────────────────────────────────

/** OKLab 两点距离平方 */
export function labDist2(p, q) {
  const dl = p[0] - q[0]
  const da = p[1] - q[1]
  const db = p[2] - q[2]
  return dl * dl + da * da + db * db
}

/** 亮度加权 RGB 距离平方 */
function weightedRgbDist2(r, g, b, c) {
  const dr = r - c.r
  const dg = g - c.g
  const db = b - c.b
  return W_R * dr * dr + W_G * dg * dg + W_B * db * db
}

/**
 * 找出调色板里最接近的颜色下标
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @param {Array<{r:number,g:number,b:number}>} palette
 * @param {'weighted-rgb'|'oklab'} [metric]
 * @returns {number} 下标；调色板为空时 -1
 */
export function nearestPaletteIndex(r, g, b, palette, metric = 'weighted-rgb') {
  if (!palette?.length) return -1
  let best = 0
  let bestD = Infinity
  if (metric === 'oklab') {
    const lab = srgbToOklab(r, g, b)
    for (let i = 0; i < palette.length; i += 1) {
      const c = palette[i]
      const d = labDist2(lab, c._lab ?? srgbToOklab(c.r, c.g, c.b))
      if (d < bestD) {
        bestD = d
        best = i
        if (d === 0) break
      }
    }
    return best
  }
  for (let i = 0; i < palette.length; i += 1) {
    const d = weightedRgbDist2(r, g, b, palette[i])
    if (d < bestD) {
      bestD = d
      best = i
      if (d === 0) break
    }
  }
  return best
}

// ─────────────────────────────────────────────────────────────
// 中位切分
// ─────────────────────────────────────────────────────────────

/** 一盒颜色（或一簇颜色）的统计: 各通道跨度 + 格子总数 */
function boxOf(items) {
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

/** 一组颜色的加权平均色（按格子数加权） */
function averageOf(items) {
  let sr = 0; let sg = 0; let sb = 0; let total = 0
  for (const c of items) { sr += c.r * c.n; sg += c.g * c.n; sb += c.b * c.n; total += c.n }
  return {
    r: clamp255(sr / total),
    g: clamp255(sg / total),
    b: clamp255(sb / total),
  }
}

/**
 * 中位切分（median cut）: 把「每种颜色 → 用了多少格」切成 n 个盒子，每盒取加权平均色
 *
 * @param {Array<{r:number,g:number,b:number,n:number}>} list
 * @param {number} n 目标盒数
 * @returns {Array<{r:number,g:number,b:number}>}
 */
function medianCut(list, n) {
  const boxes = [boxOf(list)]
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

    boxes.splice(bi, 1, boxOf(b.items.slice(0, cut)), boxOf(b.items.slice(cut)))
  }

  return boxes.map((b) => averageOf(b.items))
}

// ─────────────────────────────────────────────────────────────
// OKLab + K-means++
// ─────────────────────────────────────────────────────────────

/** 可复现的伪随机数（mulberry32）: 同一个种子给出同一串数 */
function mulberry32(seed) {
  let a = (Math.trunc(seed) || 0) >>> 0
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 随机种子（界面上「换一个」用） */
export function randomSeed() {
  return Math.floor(Math.random() * 1e9)
}

/**
 * OKLab + K-means++ 调色板
 *
 * - 颜色先转到 OKLab（感知均匀），距离就在 OKLab 里算
 * - K-means++ 初始化: 第一个中心按「格子数」权重随机取，之后按 权重 × D² 取
 *   （D = 到已选中心的最近 OKLab 距离），随机种子决定这一串选择
 * - 之后做若干轮 Lloyd 迭代: 按最近中心归类 → 取加权均值当新中心
 *
 * @param {Array<{r:number,g:number,b:number,n:number}>} list
 * @param {number} n 目标颜色数
 * @param {{seed?:number, iterations?:number}} [opts]
 * @returns {Array<{r:number,g:number,b:number}>}
 */
function oklabKmeansCut(list, n, opts = {}) {
  const k = Math.max(1, Math.trunc(n))
  if (!list?.length) return []
  if (k >= list.length) return list.map((c) => ({ r: c.r, g: c.g, b: c.b }))

  const iterations = Math.max(1, Math.min(64, Math.trunc(opts.iterations) || 12))
  const rand = mulberry32(opts.seed ?? 0)

  const w = new Float64Array(list.length)
  const lab = new Array(list.length)
  for (let i = 0; i < list.length; i += 1) {
    const c = list[i]
    w[i] = c.n > 0 ? c.n : 1
    lab[i] = srgbToOklab(c.r, c.g, c.b)
  }

  // 按权重随机取一个下标（K-means++ 第一步）
  const pickWeighted = (weights) => {
    let sum = 0
    for (let i = 0; i < weights.length; i += 1) sum += weights[i]
    if (!(sum > 0)) return 0
    let target = rand() * sum
    for (let i = 0; i < weights.length; i += 1) {
      target -= weights[i]
      if (target <= 0) return i
    }
    return weights.length - 1
  }

  const centres = [lab[pickWeighted(w)].slice()]
  const d2 = new Float64Array(list.length).fill(Infinity)
  while (centres.length < k) {
    const last = centres[centres.length - 1]
    const weights = new Float64Array(list.length)
    for (let i = 0; i < list.length; i += 1) {
      const d = labDist2(lab[i], last)
      if (d < d2[i]) d2[i] = d
      weights[i] = w[i] * d2[i]
    }
    const idx = pickWeighted(weights)
    if (d2[idx] === 0) {
      // 已经没有「离所有中心都远」的颜色了（剩下的都重合），补一个还没被选中的
      let fallback = -1
      for (let i = 0; i < list.length; i += 1) {
        if (!centres.some((c) => labDist2(c, lab[i]) === 0)) { fallback = i; break }
      }
      if (fallback < 0) break
      centres.push(lab[fallback].slice())
      continue
    }
    centres.push(lab[idx].slice())
  }

  // Lloyd 迭代（加权均值）
  const assign = new Int32Array(list.length).fill(-1)
  const sumL = new Float64Array(centres.length)
  const sumA = new Float64Array(centres.length)
  const sumB = new Float64Array(centres.length)
  const sumW = new Float64Array(centres.length)
  for (let it = 0; it < iterations; it += 1) {
    sumL.fill(0); sumA.fill(0); sumB.fill(0); sumW.fill(0)
    let changed = false
    for (let i = 0; i < list.length; i += 1) {
      let best = 0
      let bestD = Infinity
      for (let c = 0; c < centres.length; c += 1) {
        const d = labDist2(lab[i], centres[c])
        if (d < bestD) { bestD = d; best = c }
      }
      if (assign[i] !== best) { assign[i] = best; changed = true }
      sumL[best] += lab[i][0] * w[i]
      sumA[best] += lab[i][1] * w[i]
      sumB[best] += lab[i][2] * w[i]
      sumW[best] += w[i]
    }
    for (let c = 0; c < centres.length; c += 1) {
      if (sumW[c] <= 0) continue // 空簇: 保留原中心
      centres[c] = [sumL[c] / sumW[c], sumA[c] / sumW[c], sumB[c] / sumW[c]]
    }
    if (!changed && it > 0) break
  }

  // 去掉没有分到格子的中心，并去重
  const used = new Set(assign)
  const out = []
  const seen = new Set()
  for (let c = 0; c < centres.length; c += 1) {
    if (!used.has(c)) continue
    const [r, g, b] = oklabToSrgb(centres[c][0], centres[c][1], centres[c][2])
    const key = `${r},${g},${b}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ r, g, b })
  }
  return out
}

/**
 * 按算法挑调色板
 * @param {Array<{r:number,g:number,b:number,n:number}>} list
 * @param {number} n
 * @param {{method?:string, seed?:number, iterations?:number, mergeNear?:boolean}} [opts]
 *   mergeNear: 合并「几乎一样」的颜色（色位很少时用，见 mergeNearColors）
 */
export function buildPalette(list, n, opts = {}) {
  const method = normalizeMethod(opts.method)
  if (!list?.length) return []
  if (list.length <= n) return list.map((c) => ({ r: c.r, g: c.g, b: c.b }))
  const palette = method === 'oklab'
    ? oklabKmeansCut(list, n, opts)
    : medianCut(list, n)
  return opts.mergeNear ? mergeNearColors(palette, list, method, opts) : palette
}

// ─────────────────────────────────────────────────────────────
// 调色板: 合并过于相近的颜色
// ─────────────────────────────────────────────────────────────

/**
 * 「过于相近」的阈值，取两把尺子里小的那个:
 *   绝对值: 该度量最大距离的 1.5%（约 1.5 个 JND，看着就是同一种颜色）
 *   相对值: 调色板自身跨度的 3%（窄范围图相邻两色天生就近，硬并会出条带）
 */
const NEAR_COLOR_ABS = 0.015
const NEAR_COLOR_REL = 0.03

/** 每个度量下「最远的两色」距离（两个度量都是纯黑↔纯白最远） */
const METRIC_RANGE = { 'weighted-rgb': 255, oklab: 1 }

/** 两色在指定度量下的距离（和归色用的是同一套度量） */
function colorDist(a, b, metric) {
  if (metric === 'oklab') {
    const la = a._lab ?? (a._lab = srgbToOklab(a.r, a.g, a.b))
    const lb = b._lab ?? (b._lab = srgbToOklab(b.r, b.g, b.b))
    return Math.sqrt(labDist2(la, lb))
  }
  return Math.sqrt(weightedRgbDist2(a.r, a.g, a.b, b))
}

/** 调色板自己铺开的范围（最远的两色有多远） */
function paletteSpread(pal, metric) {
  let best = 0
  for (let i = 0; i < pal.length; i += 1) {
    for (let j = i + 1; j < pal.length; j += 1) {
      const d = colorDist(pal[i], pal[j], metric)
      if (d > best) best = d
    }
  }
  return best
}

/** 把每种颜色归到最近的调色板色上，返回每个调色板色分到的颜色（带格子数） */
function bucketize(list, palette, metric) {
  const buckets = palette.map(() => [])
  for (const c of list) buckets[nearestPaletteIndex(c.r, c.g, c.b, palette, metric)].push(c)
  return buckets
}

/**
 * 从某一簇里切出两个颜色（切不动返回 null）
 * 挑当前量化误差最大的那一簇；切出来若还是两个挨得很近的颜色就换下一簇，免得来回打转
 */
function splitWidest(list, palette, method, opts, limit) {
  const metric = metricOf(method)
  const buckets = bucketize(list, palette, metric)
  const order = buckets
    .map((items, i) => {
      let err = 0
      for (const c of items) err += colorDist(c, palette[i], metric) ** 2 * c.n
      return { i, err }
    })
    .filter((o) => buckets[o.i].length >= 2) // 一簇里只有一种颜色，切不出两个
    .sort((a, b) => b.err - a.err)

  for (const { i } of order) {
    const pair = method === 'oklab'
      ? oklabKmeansCut(buckets[i], 2, opts)
      : medianCut(buckets[i], 2)
    if (pair.length < 2) continue
    if (colorDist(pair[0], pair[1], metric) < limit) continue
    return { index: i, pair }
  }
  return null
}

/**
 * 合并过于相近的颜色: 反复「最近的一对合成一色 → 空出的名额给误差最大的那一簇」
 * 名额给不出去就少用一色（图里本来就没那么多种分得开的颜色）
 */
function mergeNearColors(palette, list, method, opts) {
  const metric = metricOf(method)
  let pal = palette

  for (let guard = 0; guard < palette.length && pal.length > 1; guard += 1) {
    const limit = Math.min(
      METRIC_RANGE[metric] * NEAR_COLOR_ABS,
      paletteSpread(pal, metric) * NEAR_COLOR_REL,
    )

    // 1) 最近的一对
    let bi = -1
    let bj = -1
    let best = Infinity
    for (let i = 0; i < pal.length; i += 1) {
      for (let j = i + 1; j < pal.length; j += 1) {
        const d = colorDist(pal[i], pal[j], metric)
        if (d < best) { best = d; bi = i; bj = j }
      }
    }
    if (best >= limit) break // 没有过于相近的颜色了

    // 2) 合并: 两簇并成一簇，代表色取加权平均
    const buckets = bucketize(list, pal, metric)
    const merged = averageOf([...buckets[bi], ...buckets[bj]])
    const next = pal.filter((_, k) => k !== bj)
    next[bj < bi ? bi - 1 : bi] = merged

    // 3) 空出来的名额给别的簇（给不出去就少一色，接着看还有没有要合的）
    const split = splitWidest(list, next, method, opts, limit)
    pal = split
      ? [...next.slice(0, split.index), ...split.pair, ...next.slice(split.index + 1)]
      : next
  }
  return pal
}
