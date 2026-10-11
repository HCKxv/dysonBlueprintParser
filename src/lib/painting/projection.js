/**
 * projection.js — 图片 → 球面 → 涂色格子 采样（彩绘生成工具）
 *
 * 只针对经纬线涂色网格（gridType 0，120 带 / 18304 格），像素先做画面调整再采样（见 adjust.js）。
 * 图片 UV: u 沿经度增大方向，v = 1 在北极。
 *
 * 四档投影（params.projMode）: hemisphere 半球面 / equator 环绕赤道 / tile 平铺（后两档共用同一套
 * 赤道带映射，见 equatorLayout）/ equirect 等距圆柱。半球与赤道带的位置都再转 180°。
 * 裁剪只有赤道带那两档有，见 cropsImage。
 */

import { buildGraticuleBands } from '../grid/paintingGrid.js';
import { adjustRgb, applyAdjustments } from './adjust.js';
import { packSample } from './encoder.js';
import { DEFAULT_PLANET_RADIUS, planetRowLat } from '../grid/planetGrid.js';

const DEG = Math.PI / 180;

// #rrggbb → [r,g,b]（解析失败返回 null）
function parseHexColor(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

// [r,g,b] → #rrggbb
function toHexColor(rgb) {
  const h = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${h(rgb[0])}${h(rgb[1])}${h(rgb[2])}`;
}

/** 四角像素各通道差都在此以内 → 算「同一个颜色」 */
const CORNER_SAME_TOL = 40;

/** alpha ≤ 这个值的像素「没有自己的颜色」，采样时不算采样点（量化图预览同一份判据，见 quantize.js） */
export const PAINT_ALPHA_MIN = 86;

/**
 * 检测图片自身背景色: 四角取色，3 角同色时忽略那个异类（水印 / 圆角），否则四角平均
 * @returns {string|null} #rrggbb
 */
export function detectImageBackground(img) {
  const iw = img.naturalWidth || img.width || 0;
  const ih = img.naturalHeight || img.height || 0;
  if (!iw || !ih) return null;

  const canvas = document.createElement('canvas');
  canvas.width = iw;
  canvas.height = ih;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, iw, ih);
  const data = ctx.getImageData(0, 0, iw, ih).data;

  const corners = [[0, 0], [iw - 1, 0], [0, ih - 1], [iw - 1, ih - 1]];
  const rgb = corners.map(([x, y]) => {
    const i = (y * iw + x) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  });

  const diff = (a, b) => Math.max(
    Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]),
  );
  // 组内两两最大通道差（同一档里挑最整齐的那组）
  const spreadOf = (idx) => {
    let worst = 0;
    for (let a = 0; a < idx.length; a += 1) {
      for (let b = a + 1; b < idx.length; b += 1) worst = Math.max(worst, diff(rgb[idx[a]], rgb[idx[b]]));
    }
    return worst;
  };

  // 枚举四角的 15 种组合，只要「三个角以上」: 取角最多、其次最整齐的一组
  let pick = null;
  let pickSpread = Infinity;
  for (let mask = 0; mask < 16; mask += 1) {
    const idx = [0, 1, 2, 3].filter((k) => (mask >> k) & 1);
    if (idx.length < 3) continue;
    const spread = spreadOf(idx);
    if (spread > CORNER_SAME_TOL) continue;
    if (idx.length > (pick ? pick.length : 0) || (pick && idx.length === pick.length && spread < pickSpread)) {
      pick = idx;
      pickSpread = spread;
    }
  }
  // 没有多数派（2:2 或四角各异）→ 四角平均
  const use = pick || [0, 1, 2, 3];

  let sr = 0; let sg = 0; let sb = 0;
  for (const k of use) { sr += rgb[k][0]; sg += rgb[k][1]; sb += rgb[k][2]; }
  return toHexColor([sr / use.length, sg / use.length, sb / use.length]);
}

// ─── 环绕赤道 ────────────────────────────────────────────────

/** 行星网格一格（一行）的高度（度）: 0.36（公式见 planetGrid.js 的 planetRowLat） */
const PLANET_ROW_LAT = planetRowLat(DEFAULT_PLANET_RADIUS);

/** 纬度范围 ±R° 的上下限（与界面滑块一致）: 环绕赤道（戴森球） */
export const EQUATOR_LAT_STOPS = { min: 30, max: 72, step: 1.5, default: 45 };
/**
 * 平铺（地基赤道带）的高度: 第 40 ~ 180 行、步长 1 格、默认第 80 行
 * （界面按「格」显示叫高度，内部存角度；40 行 = 14.4°、180 行 = 64.8°）
 */
export const TILE_LAT_ROWS = { min: 40, max: 180, step: 1, default: 80 };
/** 行数 → 纬度（度）: 抹掉 80 × 0.36 这类浮点尾巴（28.799999999999997） */
const rowsToLat = (rows) => Number((rows * PLANET_ROW_LAT).toFixed(6));
export const TILE_LAT_STOPS = {
  min: rowsToLat(TILE_LAT_ROWS.min),
  max: rowsToLat(TILE_LAT_ROWS.max),
  step: rowsToLat(TILE_LAT_ROWS.step),
  default: rowsToLat(TILE_LAT_ROWS.default),
};
/** 重复次数上限 = 赤道带的经向格数（再细就小于一个格子、涂不出来了） */
const EQUATOR_MAX_REPEATS = Math.max(...buildGraticuleBands().map((b) => b.seg));
/** 单轴裁剪量上限（%）: 界面滑块也用这个数 */
export const EQUATOR_MAX_CROP = 50;
/** 裁剪位置上限（%，相对裁剪量）: 界面滑块也用这个数 */
export const EQUATOR_MAX_CROP_POS = 100;

/** 实际铺几份: 平铺固定一份，环绕赤道用界面上的重复次数（采样 / 界面排布 / 量化图裁剪共用） */
export function repeatsForMode(projMode, repeats) {
  return projMode === 'tile' ? 1 : repeats;
}

/** 某一档投影模式用的纬度范围上下限（平铺是地基专用的一档，范围不一样） */
export function latStopsOf(projMode) {
  return projMode === 'tile' ? TILE_LAT_STOPS : EQUATOR_LAT_STOPS;
}

/**
 * 这次生成用的高度 / 纬度范围（按生成模式取；只有赤道带那两档会用到）
 *
 * @param {{paintMode?:string, equatorLatSphere?:number, equatorLatFoundation?:number}} params
 */
export function latRangeOf({ paintMode, equatorLatSphere, equatorLatFoundation }) {
  return paintMode === 'foundation' ? equatorLatFoundation : equatorLatSphere;
}

/** ±R° 限幅（非法值 → 该档默认值）: 按投影模式取上下限 */
function clampLatForProjMode(v, projMode) {
  const stops = latStopsOf(projMode);
  const n = Number(v);
  const r = Number.isFinite(n) && n > 0 ? n : stops.default;
  return Math.min(stops.max, Math.max(stops.min, r));
}

/** 裁剪量限幅（0 - EQUATOR_MAX_CROP%，非法值 → 0） */
function clampCropPercent(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(EQUATOR_MAX_CROP, n);
}

/** 裁剪位置限幅（±EQUATOR_MAX_CROP_POS%，非法值 → 0） */
function clampCropPosition(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(EQUATOR_MAX_CROP_POS, Math.max(-EQUATOR_MAX_CROP_POS, n));
}

/**
 * 环绕赤道的排布参数（界面与采样共用）
 *
 * @param {{latRangeDeg?:number, aspect?:number, repeats?:number, cropV?:number, cropH?:number,
 *          cropVPos?:number, cropHPos?:number, projMode?:string}} o
 *   aspect 图片宽高比（宽/高）；cropV / cropH 裁剪量（0-50%）；cropVPos / cropHPos 裁剪位置（±100%）
 * @returns {{latRange:number, naturalWidth:number, copyWidth:number, copyHeight:number,
 *            maxRepeats:number, repeats:number, period:number,
 *            cropU0:number, cropV0:number, cropUSpan:number, cropVSpan:number}}
 *   宽高与 period 单位都是「度」；裁剪窗口是图片 UV（v = 1 在顶边），不裁剪时 = 0, 0, 1, 1
 */
export function equatorLayout({ latRangeDeg, aspect, repeats, cropV, cropH, cropVPos, cropHPos, projMode } = {}) {
  const latRange = clampLatForProjMode(latRangeDeg, projMode);
  // 裁剪量按比例取，位置按「裁剪量」取 —— 都先归一化到 0-1
  const cv = clampCropPercent(cropV) / 100;
  const ch = clampCropPercent(cropH) / 100;
  const pv = clampCropPosition(cropVPos) / 200 + 0.5;
  const ph = clampCropPosition(cropHPos) / 200 + 0.5;

  // 裁剪后的可见宽高比（环带高度仍由 ±R° 决定，所以裁掉的部分 = 放大剩下的内容）
  const a = Math.max(1e-3, (Number(aspect) || 1) * (1 - ch) / (1 - cv));
  const naturalWidth = 2 * latRange * a;
  // +1e-9: 正好整除时（90° 宽 → 4 份）避免浮点少算一份
  const maxRepeats = Math.max(
    1,
    Math.min(EQUATOR_MAX_REPEATS, Math.floor(360 / naturalWidth + 1e-9)),
  );
  const n = Math.min(maxRepeats, Math.max(1, Math.round(Number(repeats) || 1)));
  const period = 360 / n;
  // 份内宽 = 原比例宽（放不进这一份时缩到份宽），高度按比例跟着缩
  const shrunk = naturalWidth > period;
  const copyWidth = shrunk ? period : naturalWidth;
  // 裁剪窗口: v = 1 在图片顶边，u 沿经度增大方向（位置 +100% = 窗口贴到对应的那一侧）
  const cropUSpan = 1 - ch;
  const cropVSpan = 1 - cv;
  return {
    latRange,
    naturalWidth,
    copyWidth,
    copyHeight: shrunk ? period / a : 2 * latRange,
    maxRepeats,
    repeats: n,
    period,
    cropU0: ch * ph,
    cropV0: cv * pv,
    cropUSpan,
    cropVSpan,
  };
}

/** 这档投影模式有没有裁剪: 只有赤道带那档（环绕赤道 / 平铺）有 */
export function cropsImage(projMode) {
  return projMode === 'equator' || projMode === 'tile';
}

/**
 * 裁剪窗口（图片 UV）→ 源图上的像素矩形（v = 1 在顶边，所以 y 要翻过来）
 * 没裁剪时返回 null；采样和量化图预览共用它，预览里看到的就是涂上去的那一块
 *
 * @param {number} imgWidth
 * @param {number} imgHeight
 * @param {{cropU0:number, cropV0:number, cropUSpan:number, cropVSpan:number}|null} crop
 * @returns {{x:number, y:number, w:number, h:number}|null}
 */
export function cropRectOf(imgWidth, imgHeight, crop) {
  if (!crop || !(imgWidth > 0) || !(imgHeight > 0)) return null;
  const spanU = Math.min(1, Math.max(0, crop.cropUSpan));
  const spanV = Math.min(1, Math.max(0, crop.cropVSpan));
  if (spanU >= 1 && spanV >= 1) return null;

  const x = Math.min(imgWidth - 1, Math.max(0, Math.round(crop.cropU0 * imgWidth)));
  const y = Math.min(imgHeight - 1, Math.max(0, Math.round((1 - crop.cropV0 - spanV) * imgHeight)));
  return {
    x,
    y,
    w: Math.max(1, Math.min(imgWidth - x, Math.round(spanU * imgWidth))),
    h: Math.max(1, Math.min(imgHeight - y, Math.round(spanV * imgHeight))),
  };
}

/**
 * 创建投影器
 * @param {CanvasImageSource & {naturalWidth?:number,width:number,height:number}} img
 * @param {object} params 见 stores/painting.ts 的 painting 对象
 */
export function createProjector(img, params) {
  const iw = img.naturalWidth || img.width || 0;
  const ih = img.naturalHeight || img.height || 0;
  if (!iw || !ih) throw new Error('图片尺寸无效');

  // 三种投影类型: 半球 / 赤道带（戴森球的「环绕赤道」与地基的「平铺」共用）/ 等距圆柱
  const isHemisphere = params.projMode === 'hemisphere';
  // 「赤道带那档」: 环绕赤道与平铺共用同一套映射（cropsImage 就是按这个分的）
  const isBand = cropsImage(params.projMode);
  const isEquirect = !isHemisphere && !isBand;

  // 经度偏移（hemiLng）: 等距圆柱 = 图片左边缘对齐的经度（平移纹理实现，画两遍即可环绕），
  // 半球投影 = 半球中心经度，赤道带 = 整条环带的旋转量（这两个都在 uvAt 里处理、不平移）
  const hemiLng = Number(params.hemiLng) || 0;
  const shiftPx = isEquirect && hemiLng
    ? ((Math.round((hemiLng / 360) * iw) % iw) + iw) % iw
    : 0;
  // 半球 / 赤道带的投影位置在经度偏移的基础上再转 180°（等距圆柱保持原义、不受影响）
  const projLng = isEquirect ? hemiLng : hemiLng + 180;

  const canvas = document.createElement('canvas');
  canvas.width = iw;
  canvas.height = ih;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('无法创建 2D 上下文');
  if (shiftPx === 0) {
    ctx.drawImage(img, 0, 0, iw, ih);
  } else {
    ctx.drawImage(img, shiftPx, 0, iw, ih);
    ctx.drawImage(img, shiftPx - iw, 0, iw, ih);
  }
  const data = ctx.getImageData(0, 0, iw, ih).data;
  // 画面调整（亮度 / 对比度 / 饱和度 / 锐度）: 全默认时内部直接返回
  applyAdjustments(data, iw, ih, params);

  // UV → 纹素: 按纹素中心 floor 取整（不用 round），极点压在图片边界上时也不会进位到图外
  function texelAt(u, v) {
    const x = Math.min(iw - 1, Math.max(0, Math.floor(u * iw)));
    const y = Math.min(ih - 1, Math.max(0, Math.floor((1 - v) * ih)));
    const i = (y * iw + x) * 4;
    return [data[i], data[i + 1], data[i + 2], data[i + 3]];
  }

  // 球面单位向量
  const DEG = Math.PI / 180;
  const toVec = (lat, lng) => {
    const la = lat * DEG;
    const lo = lng * DEG;
    const cl = Math.cos(la);
    return [cl * Math.sin(lo), Math.sin(la), -cl * Math.cos(lo)];
  };
  // 半球局部坐标系: axis = 中心方向，east = axis × 北（经度增大方向），north = axis × east
  const AXIS = toVec(0, projLng);
  const REF_N = [0, 1, 0];
  const EAST = [
    AXIS[1] * REF_N[2] - AXIS[2] * REF_N[1],
    AXIS[2] * REF_N[0] - AXIS[0] * REF_N[2],
    AXIS[0] * REF_N[1] - AXIS[1] * REF_N[0],
  ];
  const NORTH = [
    AXIS[1] * EAST[2] - AXIS[2] * EAST[1],
    AXIS[2] * EAST[0] - AXIS[0] * EAST[2],
    AXIS[0] * EAST[1] - AXIS[1] * EAST[0],
  ];
  const cosLimit = -1e-9; // cos 90°: 略放宽，让恰好 90° 的点也算图内
  /** 角距 75° 起渐隐到底色，90° 全是底色 */
  const FADE_FROM = Math.cos(75 * DEG);

  // 图片调整（仅半球投影）: 缩放 1 = 原样；移动为百分比（1% = 图片半宽/半高），正 = 东/北。
  // 用 finite 而非 ??: 参数缺省时 Number(undefined) 是 NaN，?? 拦不住
  const finite = (v, dflt) => (Number.isFinite(Number(v)) ? Number(v) : dflt);
  const zoom = Math.max(0.01, finite(params.imgZoom, 1));
  const shiftX = finite(params.imgShiftX, 0) / 100;
  const shiftY = finite(params.imgShiftY, 0) / 100;
  // 图片半宽、半高（按长边归一化，都 ≤ 0.5 = 圆盘半径）: 整图在圆盘内且不变形
  const halfLong = Math.max(iw, ih) / 2;
  const ex = (iw / 2) / halfLong;
  const ey = (ih / 2) / halfLong;

    // 底色（图外填充色的颜色）: 只认 params.fillColor —— 调用方先用 resolveFillColor 把 fillMode
    // 解析成实际颜色（none → null、bg → 取图片背景色），null 就是图外的格子不涂色
  const fillHex = parseHexColor(params.fillColor) || [0, 0, 0];
  const fillRgb = params.fillColor == null
    ? null
    : params.fillMode === 'bg'
      ? adjustRgb(fillHex, params)
      : fillHex;
  /** 取不到图片颜色的格子涂什么: 底色 / null（不涂色） */
  const outCell = fillRgb ? { r: fillRgb[0], g: fillRgb[1], b: fillRgb[2], a: 255 } : null;

  // 是否在图片内: 半开区间 [0,1) + 容限（极点压在图片边界上时，
  // 闭区间会因浮点误差 vv = -8.7e-18 把整条极点带判成图外）
  function inImage(uu, vv) {
    const EPS = 1e-9;
    return uu >= -EPS && uu < 1 - EPS && vv >= -EPS && vv < 1 - EPS;
  }

  // 等距圆柱: 图宽 = 360° 经度（本初子午线 = 左边缘），图高 = 360/aspect 度纬度、以赤道居中
  //   → 2:1 铺满整球、4:1 只铺到 ±45；超出 ±latLimit 的极冠用底色
  const aspect = iw / ih;
  const halfLat = 180 / aspect;
  const latLimit = Math.min(90, halfLat);

  // 环绕赤道 / 平铺: 见 equatorLayout；份中心在经度 0° + k×period，「经度偏移」把整条环带一起转
  // （平铺固定一份，不用界面的重复次数）
  const eq = isBand
    ? equatorLayout({
      latRangeDeg: latRangeOf(params),
      aspect,
      repeats: repeatsForMode(params.projMode, params.equatorRepeats),
      cropV: params.equatorCropV,
      cropH: params.equatorCropH,
      cropVPos: params.equatorCropVPos,
      cropHPos: params.equatorCropHPos,
      projMode: params.projMode,
    })
    : null;
  // 图片在纬度方向的半高: 正常 = R，图被缩到一圈时更小
  const eqHalfLat = eq ? eq.copyHeight / 2 : 0;

  // 边缘过渡系数（uvAt 会更新，采样时向底色靠拢）
  let blend = 1;

    /**
     * 图片边界判定用的浮点容差（度）: 不留的话，正好压在图片边上的那圈格子会一边算图内、
     * 一边算图外（南边凭空多一行）
     */
  const EDGE_EPS = 1e-9;

    /**
     * 球面经纬度 → 图片 UV（null = 图外）
     * 等距圆柱: 经度 0° = 图片左边缘，上 / 下边 = 北 / 南极（已用真实涂色蓝图逐格比对）
     * 半球: 图片中心 → 半球中心；赤道带: 图片中心 → 赤道 + 份中心，份内再取裁剪窗口那一块
     */
  function uvAt(lat, lng) {
    let dx;
    let dy;
    blend = 1; // 1 = 取原图颜色，0 = 底色；只有半球边缘过渡会改它

    if (isHemisphere) {
      if (lat < -90 || lat > 90) return null;
      // 1) 半球局部坐标: a = 轴向分量 = cos 角距，半球外即图外
      const p = toVec(lat, lng);
      const a = p[0] * AXIS[0] + p[1] * AXIS[1] + p[2] * AXIS[2];
      if (a <= cosLimit) return null;
      // 2) 正交投到图片平面: 圆盘半径 = sin(角距)
      const s = Math.sqrt(Math.max(0, 1 - a * a));
      const px = p[0] * EAST[0] + p[1] * EAST[1] + p[2] * EAST[2];
      const py = p[0] * NORTH[0] + p[1] * NORTH[1] + p[2] * NORTH[2];
      const r = Math.hypot(px, py);
      const k = r > 1e-12 ? s / r : 0;
      // 3) 归一化到图片 UV: 取负号让「北 → v 更大」；两轴各按自己的半宽/半高折算（不变形）；
      //    位移 = 图片往正方向挪，采样点要反方向退回
      const wx = (px * k) / (2 * ex) - shiftX;
      const wy = (-py * k) / (2 * ey) - shiftY;
      dx = wx / zoom;
      dy = wy / zoom;
      // 4) 边缘过渡: a 从 FADE_FROM 降到 cosLimit 时 blend 由 1 到 0
      blend = a >= FADE_FROM ? 1 : (a - cosLimit) / (FADE_FROM - cosLimit);
    } else if (isBand) {
        // 赤道带的上下、左右都用开区间: 正好压在图片边界上的点不算图内，否则会多涂一圈格子
      if (lat <= -eqHalfLat + EDGE_EPS || lat >= eqHalfLat - EDGE_EPS) return null;
      dy = lat / eq.copyHeight; // 图片中心在赤道，上下边 = ±copyHeight/2
      // 到最近一份中心的经度差（份中心在 projLng + k×period）→ 落在空隙即图外
      let d = (lng - projLng) % eq.period;
      if (d < 0) d += eq.period;
      if (d > eq.period / 2) d -= eq.period;
      if (Math.abs(d) >= eq.copyWidth / 2 - EDGE_EPS) return null;
      dx = d / eq.copyWidth;
      // 裁剪: 份内的 ±0.5 线性映射到「裁剪窗口」内（不裁剪时窗口 = 整图，映射回原样）
      dx = eq.cropU0 + (dx + 0.5) * eq.cropUSpan - 0.5;
      dy = eq.cropV0 + (dy + 0.5) * eq.cropVSpan - 0.5;
    } else {
      // 等距圆柱: 经纬度线性映射；超出图片覆盖的纬度即图外（极冠）
      if (lat <= -latLimit + EDGE_EPS || lat >= latLimit - EDGE_EPS) return null;
      let u = (lng / 360) % 1;
      if (u < 0) u += 1;
      dx = u - 0.5;
      dy = lat / (2 * halfLat);
    }

    // v = 1 在图片顶边（北极）: 纬度越高 dy 越大
    const uu = 0.5 + dx;
    const vv = 0.5 + dy;
    if (!inImage(uu, vv)) return null;
    return [uu, vv];
  }

    // 等距圆柱的映射可分离（经度定列、纬度定行），每格在图上就是个轴对齐矩形，预先算好即可
  const bands = buildGraticuleBands();
  const totalCells = bands.reduce((acc, b) => acc + b.seg, 0);
  const cellRects = new Array(totalCells);

  // 区域平均 = 每格约 25 点求平均；最近邻 = 每格取中心 1 个像素
  const resample = params.resample || 'average';
  const TARGET_SAMPLES = resample === 'average' ? 25 : 1;

  // 每格的像素矩形（半开区间 [x0,x1) × [y0,y1)）: 只有等距圆柱用得上（半球的格子是曲面片、
  // 环绕赤道的格子可能横跨「图片 / 空隙」，两者都走逐点采样）
  const useRects = isEquirect;
  for (const band of bands) {
    if (!useRects) break;
    const step = 360 / band.seg;
    // 纬度裁剪到 latLimit → 极冠的矩形为空（= 图外）
    const latHi = Math.min(band.latHi, latLimit);
    const latLo = Math.max(band.latLo, -latLimit);
    const hasLat = latHi > latLo;
    const y0 = hasLat ? Math.max(0, Math.floor((0.5 - latHi / (2 * halfLat)) * ih)) : 0;
    const y1 = hasLat ? Math.min(ih, Math.ceil((0.5 - latLo / (2 * halfLat)) * ih)) : 0;
    for (let li = 0; li < band.seg; li += 1) {
      // 图片整宽 = 360°，格子按经度比例落到列范围
      const x0 = Math.floor((li / band.seg) * iw);
      const x1 = Math.ceil(((li + 1) / band.seg) * iw);
      cellRects[band.base + li] = {
        x0,
        x1,
        y0,
        y1,
      };
    }
  }

  /** 在矩形内取样: targetSamples > 1 时按 stride 撒点求平均，= 1 时只取矩形中心那个像素 */
  function sampleRect(r, targetSamples) {
    const x0 = r.x0;
    const x1 = r.x1;
    const y0 = r.y0;
    const y1 = r.y1;
    const w = x1 - x0;
    const h = y1 - y0;
    if (w <= 0 || h <= 0) return null;

    // 最近邻取中心像素（不是左上角），与逐点采样的「格子中心」语义对齐
    if (targetSamples <= 1) {
      const i = ((y0 + (h >> 1)) * iw + (x0 + (w >> 1))) * 4;
      if (data[i + 3] < PAINT_ALPHA_MIN) return outCell; // 透明 → 底色 / 不涂色
      return { r: data[i], g: data[i + 1], b: data[i + 2], a: 255 };
    }

    const stride = Math.max(1, Math.floor(Math.sqrt((w * h) / targetSamples)));
    let sr = 0;
    let sg = 0;
    let sb = 0;
    let n = 0;
    for (let y = y0; y < y1; y += stride) {
      let i = (y * iw + x0) * 4;
      for (let x = x0; x < x1; x += stride) {
        // 透明像素（a ≤ 85）没有自己的颜色，不算采样点
        if (data[i + 3] >= PAINT_ALPHA_MIN) {
          sr += data[i]; sg += data[i + 1]; sb += data[i + 2];
          n += 1;
        }
        i += stride * 4;
      }
    }
    if (n === 0) return outCell; // 整格都没有可用颜色 → 底色 / 不涂色
    return {
      r: Math.round(sr / n),
      g: Math.round(sg / n),
      b: Math.round(sb / n),
      a: 255,
    };
  }

  // ── 逐点采样（半球 / 环绕赤道）: 每格按经纬范围取点，走 uvAt ──
  const AREA_DIV = 4;
  let accR = 0, accG = 0, accB = 0, accN = 0;
  /** 本格是否整格都在图内（要求整格在图内，否则边缘会往外多出一圈格子） */
  let allIn = true;

  function addSampleLatLng(lat, lng) {
    const uv = uvAt(lat, lng);
    if (!uv) { allIn = false; return; } // 图外 → 整格不涂
    const col = texelAt(uv[0], uv[1]);
    if (col[3] < PAINT_ALPHA_MIN) return; // 透明（a ≤ 85）没有自己的颜色，不算采样点
    const cr = col[0];
    const cg = col[1];
    const cb = col[2];
    // 边缘过渡: blend < 1 时向底色靠拢（没有底色就不过渡）
    const b = fillRgb ? blend : 1;
    accR += b === 1 ? cr : cr * b + fillRgb[0] * (1 - b);
    accG += b === 1 ? cg : cg * b + fillRgb[1] * (1 - b);
    accB += b === 1 ? cb : cb * b + fillRgb[2] * (1 - b);
    accN += 1;
  }

  function sampleCellByPoints(band, li, step) {
    const lngLo = li * step;
    accR = 0; accG = 0; accB = 0; accN = 0; allIn = true;
    if (TARGET_SAMPLES > 1) {
      for (let a = 0; a <= AREA_DIV; a += 1) {
        const lat = band.latLo + (band.latHi - band.latLo) * (a / AREA_DIV);
        for (let b = 0; b <= AREA_DIV; b += 1) {
          addSampleLatLng(lat, lngLo + (step * b) / AREA_DIV);
        }
      }
    } else {
      addSampleLatLng((band.latLo + band.latHi) / 2, lngLo + step / 2);
    }
    if (accN > 0 && allIn) {
      return {
        r: Math.round(accR / accN),
        g: Math.round(accG / accN),
        b: Math.round(accB / accN),
        a: 255,
      };
    }
    // 没有可用采样点 / 有采样点在图外 → 底色 / 不涂色
    return outCell;
  }

  /**
   * 按格子采样（下标 = 游戏 fillGrid.colors 的格子序号 = 带内累计偏移 + 经向序号）
   * 等距圆柱走矩形抽样，半球 / 环绕赤道走逐点采样
   *
   * @param {(done:number,total:number)=>void} [onProgress]
   * @returns {Array<{r:number,g:number,b:number,a:number}|null>} null = 不涂色
   */
  function sampleCells(onProgress) {
    const out = new Array(totalCells).fill(null);
    const reportEvery = Math.max(1, Math.floor(totalCells / 50));
    let done = 0;

    for (const band of bands) {
      const step = 360 / band.seg;
      for (let li = 0; li < band.seg; li += 1) {
        const c = band.base + li;
        if (useRects) {
          const r = cellRects[c];
          if (!r || r.x1 <= r.x0 || r.y1 <= r.y0) {
            // 空矩形 = 整格在图片覆盖的纬度之外（极冠）
            out[c] = outCell;
          } else {
            // 矩形内取像素平均（全是透明像素时 sampleRect 同样落到 outCell）
            out[c] = sampleRect(r, TARGET_SAMPLES);
          }
        } else {
          out[c] = sampleCellByPoints(band, li, step);
        }

        done += 1;
        if (onProgress && (done % reportEvery === 0 || done === totalCells)) onProgress(done, totalCells);
      }
    }

    return out;
  }

    // ── 行星地基网格采样（地基彩绘） ─────────────────────────────
    // 32 万格、比戴森球网格密得多: 结果用 Uint32Array 装压缩色，撒点数按「一格在图上几个像素」定

  /** 一格在图上大致几个像素（取图片短边当 180°，赤道一圈 1000 格） */
  const pxPerCell = Math.min(iw, ih) / 500;
  /** 每格的撒点档位: 1 → 2×2、2 → 3×3、4 → 5×5；最近邻模式只取格中心 */
  const planetAreaDiv = TARGET_SAMPLES > 1
    ? (pxPerCell >= 6 ? 4 : pxPerCell >= 3 ? 2 : 1)
    : 0;

  /** 图外格子铺什么: 压缩底色 / 0（不铺地基） */
  const planetFill = outCell ? packSample(outCell.r, outCell.g, outCell.b) : 0;

  /**
   * 格内撒点求平均 → 压缩色
   * @param {number} latLo 纬度下界（度）
   * @param {number} latHi 纬度上界（度）
   * @param {number} lngLo 经度左界（度）
   * @param {number} lngHi 经度右界（度）
   */
  function samplePlanetCell(latLo, latHi, lngLo, lngHi) {
    accR = 0; accG = 0; accB = 0; accN = 0; allIn = true;
    if (planetAreaDiv > 0) {
      for (let a = 0; a <= planetAreaDiv; a += 1) {
        const lat = latLo + (latHi - latLo) * (a / planetAreaDiv);
        for (let b = 0; b <= planetAreaDiv; b += 1) {
          addSampleLatLng(lat, lngLo + (lngHi - lngLo) * (b / planetAreaDiv));
        }
      }
    } else {
      addSampleLatLng((latLo + latHi) / 2, (lngLo + lngHi) / 2);
    }
    // 整格在图外 / 有采样点在图外 → 不铺
    if (accN <= 0 || !allIn) return planetFill;
    return packSample(Math.round(accR / accN), Math.round(accG / accN), Math.round(accB / accN));
  }

  /**
   * 按行星地基网格采样（下标 = planetGrid 的格子序号）
   * @param {object} grid createPlanetGrid() 的结果
   * @param {(done:number,total:number)=>void} [onProgress]
   * @returns {Uint32Array} 每格的压缩色；0 = 不铺地基
   */
  function samplePlanetGrid(grid, onProgress) {
    const out = new Uint32Array(grid.total);
    const reportEvery = Math.max(1, Math.floor(grid.latitudeCount / 20));
    let done = 0;

    for (let r = 0; r < grid.latitudeCount; r += 1) {
      const row = grid.rows[r];
      const half = Math.trunc(row.cells / 2);
      const cellAngle = 360 / row.cells;
      for (let x = 0; x < row.cells; x += 1) {
        // 经度范围: 东半圈 [x, x+1] 格，西半圈 [-(x-half+1), -(x-half)] 格
        const lngLo = (x < half ? x : -(x - half + 1)) * cellAngle;
        out[row.base + x] = samplePlanetCell(row.latLo, row.latHi, lngLo, lngLo + cellAngle);
      }
      done += row.cells;
      if (onProgress && (r % reportEvery === 0 || r === grid.latitudeCount - 1)) {
        onProgress(done, grid.total);
      }
    }

    return out;
  }

  return {
    sampleCells,
    samplePlanetGrid,
    uvAt,
  };
}
