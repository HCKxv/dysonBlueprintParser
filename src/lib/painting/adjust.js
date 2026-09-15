/**
 * adjust.js — 画面调整: 亮度 / 对比度 / 饱和度 / 锐度
 */

/** 锐度 100% 时的反锐化强度 */
const SHARPEN_STRENGTH = 1.5;

/** 参数 → 倍率（缺省 / 非法值按 0 算 = 原样） */
function factors(o) {
  const pct = (v, dflt) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : dflt;
  };
  return {
    brightness: 1 + pct(o?.brightness, 0) / 100,
    contrast: 1 + pct(o?.contrast, 0) / 100,
    saturation: 1 + pct(o?.saturation, 0) / 100,
    sharpness: Math.max(0, pct(o?.sharpness, 0)) / 100,
  };
}

/**
 * 单像素的亮度 / 对比度 / 饱和度（就地改 d 的第 p 个像素）
 * Uint8ClampedArray 自带四舍五入与 0-255 限幅，直接赋值即可
 */
function tonePixel(d, p, b, c, s) {
  let r = d[p] * b;
  let g = d[p + 1] * b;
  let bl = d[p + 2] * b;
  if (c !== 1) {
    r = (r - 128) * c + 128;
    g = (g - 128) * c + 128;
    bl = (bl - 128) * c + 128;
  }
  if (s !== 1) {
    const l = 0.299 * r + 0.587 * g + 0.114 * bl;
    r = l + (r - l) * s;
    g = l + (g - l) * s;
    bl = l + (bl - l) * s;
  }
  d[p] = r;
  d[p + 1] = g;
  d[p + 2] = bl;
}

/**
 * 单个颜色的亮度 / 对比度 / 饱和度（锐度对纯色无意义，不参与）
 * @param {number[]} rgb [r,g,b]
 * @param {object} o 同 applyAdjustments
 * @returns {number[]} 新的 [r,g,b]
 */
export function adjustRgb(rgb, o) {
  const f = factors(o);
  const buf = new Uint8ClampedArray([rgb[0], rgb[1], rgb[2], 0]);
  tonePixel(buf, 0, f.brightness, f.contrast, f.saturation);
  return [buf[0], buf[1], buf[2]];
}

/**
 * 反锐化掩模: 3×3 高斯模糊（可分离 1-2-1）后按强度放大「原图 − 模糊」
 * 先横后纵，纵向那一遍算完直接写回 data（模糊值取自横向结果，不影响）
 */
function unsharpMask(data, w, h, amount) {
  const blur = new Uint8ClampedArray(w * h * 3);
  for (let y = 0; y < h; y += 1) {
    const row = y * w;
    for (let x = 0; x < w; x += 1) {
      const xm = (row + (x > 0 ? x - 1 : 0)) * 4;
      const xc = (row + x) * 4;
      const xp = (row + (x < w - 1 ? x + 1 : w - 1)) * 4;
      const o = (row + x) * 3;
      blur[o] = (data[xm] + 2 * data[xc] + data[xp]) >> 2;
      blur[o + 1] = (data[xm + 1] + 2 * data[xc + 1] + data[xp + 1]) >> 2;
      blur[o + 2] = (data[xm + 2] + 2 * data[xc + 2] + data[xp + 2]) >> 2;
    }
  }
  for (let x = 0; x < w; x += 1) {
    for (let y = 0; y < h; y += 1) {
      const ym = ((y > 0 ? y - 1 : 0) * w + x) * 3;
      const yc = (y * w + x) * 3;
      const yp = ((y < h - 1 ? y + 1 : h - 1) * w + x) * 3;
      const p = (y * w + x) * 4;
      data[p] = data[p] + amount * (data[p] - (blur[ym] + 2 * blur[yc] + blur[yp]) / 4);
      data[p + 1] = data[p + 1] + amount * (data[p + 1] - (blur[ym + 1] + 2 * blur[yc + 1] + blur[yp + 1]) / 4);
      data[p + 2] = data[p + 2] + amount * (data[p + 2] - (blur[ym + 2] + 2 * blur[yc + 2] + blur[yp + 2]) / 4);
    }
  }
}

/**
 * 就地调整 RGBA 像素缓冲
 * @param {Uint8ClampedArray} data RGBA 缓冲
 * @param {number} w 宽（像素）
 * @param {number} h 高（像素）
 * @param {{brightness?:number, contrast?:number, saturation?:number, sharpness?:number}} o 百分比
 */
export function applyAdjustments(data, w, h, o) {
  const f = factors(o);
  if (f.brightness === 1 && f.contrast === 1 && f.saturation === 1 && f.sharpness === 0) return;

  const total = w * h;
  if (f.brightness !== 1 || f.contrast !== 1 || f.saturation !== 1) {
    for (let i = 0; i < total; i += 1) {
      tonePixel(data, i * 4, f.brightness, f.contrast, f.saturation);
    }
  }
  if (f.sharpness > 0) unsharpMask(data, w, h, f.sharpness * SHARPEN_STRENGTH);
}
