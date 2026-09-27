/**
 * imageLoader.js — 图片载入（同一个地址只解码一次）
 *
 * 载入图片文件、投影采样、量化图预览都要拿到同一张图；
 * 缓存按 URL 命中，一张 4K 图就不会被解码三遍
 */

/** URL → 已载入的图片（失败的那次不留在缓存里，下次重新试） */
const cache = new Map()

/**
 * 载入图片
 * @param {string} src 图片地址（blob / data / http 都行）
 * @returns {Promise<HTMLImageElement>}
 */
export function loadImage(src) {
  const cached = cache.get(src)
  if (cached) return cached
  const p = new Promise((resolve, reject) => {
    const img = new Image()
    // http 图源也要能读像素（采样要 getImageData）
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => {
      cache.delete(src)
      reject(new Error('图片载入失败'))
    }
    img.src = src
  })
  cache.set(src, p)
  return p
}

/** 丢掉某个地址的缓存（换图 / 清空图片时把上一张的解码结果放掉） */
export function forgetImage(src) {
  cache.delete(src)
}
