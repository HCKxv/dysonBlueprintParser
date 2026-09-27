/** imageLimits.js — 输入图片的尺寸限制 */

/** 允许的长宽比倍数（4:1，横竖对称） */
export const MAX_IMAGE_ASPECT = 4

/**
 * 检查图片长宽比是否在允许范围内
 * @param {number} width 像素宽
 * @param {number} height 像素高
 * @returns {string|null} 不合格时返回给用户看的原因（合格 = null）
 */
export function imageAspectError(width, height) {
  const w = Number(width)
  const h = Number(height)
  if (!(w > 0) || !(h > 0)) return '图片尺寸无效'
  const aspect = w / h
  if (aspect > MAX_IMAGE_ASPECT || aspect < 1 / MAX_IMAGE_ASPECT) {
    const wide = aspect >= 1
    // 只裁到 3 位小数、去掉多余的 0: 4.002:1 这种刚好超一点的也看得清
    const shown = (wide ? aspect : 1 / aspect).toFixed(3).replace(/\.?0+$/, '')
    return `图片${wide ? '过宽' : '过高'}：长宽比 ${shown}:1 超出 ${MAX_IMAGE_ASPECT}:1，请先裁剪后再载入`
  }
  return null
}
