/**
 * quantize.js — 量化图（把图片按调色板压成 16 色）
 *
 * 地基彩绘最后会压到 16 色（行星上能用的自定义色就 16 个），这里把「画面效果调整后」的
 * 原图逐像素映射到调色板里最接近的颜色，直接看到量化之后长什么样 —— 用的是
 * foundationResult.palette 这一份调色板，和真正写进蓝图的颜色一致。
 *
 * 预览用: 高度最多 OUT_HEIGHT 像素（只缩小、不放大），宽度按（裁剪后的）原图比例算，纯 CPU 逐像素跑。
 */

import { applyAdjustments } from './adjust.js'
import { loadImage } from './imageLoader.js'
import { PAINT_ALPHA_MIN } from './projection.js'
import { W_R, W_G, W_B, labDist2, metricOf, nearestPaletteIndex, srgbToOklab } from './quantizeAlgorithms.js'

/** 量化图高度上限（像素）: 比它矮的图保持原样，只缩不放 */
const OUT_HEIGHT = 360

/**
 * 把图片画成量化图（画面效果调整 → 逐像素取调色板里最接近的颜色）
 *
 * @param {string} url 图片地址（blob / data / http 都行）
 * @param {Array<{r:number,g:number,b:number}>} palette 调色板（1-16 色）
 * @param {{brightness?:number,contrast?:number,saturation?:number,sharpness?:number}} [adjust]
 * @param {string} [method] 量化算法（median / oklab），决定归色用的距离度量
 * @param {{x:number,y:number,w:number,h:number}|null} [crop] 只画源图的这一块（裁剪窗口，见 cropRectOf）
 * @returns {Promise<HTMLCanvasElement>} 量化后的画布
 */
export async function drawQuantizedImage(url, palette, adjust = {}, method = 'median', crop = null) {
  if (!url) throw new Error('还没有载入图片')
  if (!palette?.length) throw new Error('还没有可用的调色板')

  const img = await loadImage(url)
  const iw = img.naturalWidth || img.width
  const ih = img.naturalHeight || img.height
  if (!iw || !ih) throw new Error('图片尺寸无效')

  // 裁剪窗口（不裁剪 = 整张图）: 采样只用到这一块，预览也只显示这一块
  const sx = crop ? Math.min(iw - 1, Math.max(0, Math.round(crop.x))) : 0
  const sy = crop ? Math.min(ih - 1, Math.max(0, Math.round(crop.y))) : 0
  const sw = crop ? Math.max(1, Math.min(iw - sx, Math.round(crop.w))) : iw
  const sh = crop ? Math.max(1, Math.min(ih - sy, Math.round(crop.h))) : ih

  // 高度最多 OUT_HEIGHT，只缩小不放大；宽度按裁剪后的比例算（不变形）
  const h = Math.max(1, Math.min(sh, OUT_HEIGHT))
  const w = Math.max(1, Math.round((sw / sh) * h))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建画布')
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h)

  const image = ctx.getImageData(0, 0, w, h)
  const data = image.data
  // 和采样用的是同一套画面效果（亮度 / 对比度 / 饱和度 / 锐度）
  applyAdjustments(data, w, h, adjust)

  const n = palette.length
  const pr = new Uint8Array(n)
  const pg = new Uint8Array(n)
  const pb = new Uint8Array(n)
  const lab = new Array(n)
  const metric = metricOf(method)
  for (let i = 0; i < n; i += 1) {
    pr[i] = palette[i].r & 0xff
    pg[i] = palette[i].g & 0xff
    pb[i] = palette[i].b & 0xff
    // OKLab 归色时调色板的 Lab 只要算一次
    if (metric === 'oklab') lab[i] = srgbToOklab(pr[i], pg[i], pb[i])
  }

  for (let p = 0; p < data.length; p += 4) {
    if (data[p + 3] <= PAINT_ALPHA_MIN) {
      data[p + 3] = 0 // 透明像素保持透明（地基不铺的地方）
      continue
    }
    const r = data[p]
    const g = data[p + 1]
    const b = data[p + 2]
    const best = metric === 'oklab'
      ? nearestLab(r, g, b, lab)
      : nearestRgb(r, g, b, pr, pg, pb)
    data[p] = pr[best]
    data[p + 1] = pg[best]
    data[p + 2] = pb[best]
    data[p + 3] = 255
  }

  ctx.putImageData(image, 0, 0)
  return canvas
}

/** 亮度加权 RGB 距离下最近的调色板下标 */
function nearestRgb(r, g, b, pr, pg, pb) {
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < pr.length; i += 1) {
    const dr = r - pr[i]
    const dg = g - pg[i]
    const db = b - pb[i]
    const d = W_R * dr * dr + W_G * dg * dg + W_B * db * db
    if (d < bestD) {
      bestD = d
      best = i
      if (d === 0) break
    }
  }
  return best
}

/** OKLab 距离下最近的调色板下标（lab 是预先算好的调色板 Lab） */
function nearestLab(r, g, b, lab) {
  const p = srgbToOklab(r, g, b)
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < lab.length; i += 1) {
    const d = labDist2(p, lab[i])
    if (d < bestD) {
      bestD = d
      best = i
      if (d === 0) break
    }
  }
  return best
}
