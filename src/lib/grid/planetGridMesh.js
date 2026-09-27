/**
 * planetGridMesh.js — 行星地基网格的预览几何
 *
 * 与同目录 paintingGrid.js 里戴森球那套并列: 那边产出壳面涂色网格的几何，
 * 这边产出行星表面（地基）网格的几何，都交给 PaintingPreview 渲染。
 * 网格本身（行列、格子序号、经纬度）见同目录 planetGrid.js。
 *
 * 半径 200 时: 一行 = 纬度 0.36°，赤道行 1000 格，全行星 325600 格。
 *   - 细线 = 每一格的边界（0.36°）
 *   - 粗线 = 每 5 格 / 每 5 行（1.8°）—— 1.8° 正好是游戏里的一个「网格单位」，
 *     也就是纬度档的跨度，赤道一圈 200 条，看起来就是一张规整的经纬网
 * 细线太密（默认视角下每格只有 1-2 像素），只在凑近看时才显示，阈值见 PLANET_FINE_GRID_MAX_DISTANCE。
 *
 * 平面展开图沿用戴森球那张的约定: 列 = 格序号（经度 0° 在左右两边、180° 在正中），
 * 行 = 纬度（北在上），每行按自己的格数均分整幅宽度 —— 越靠极点格子越宽。
 */

import { latLngToLocal } from './paintingGrid.js';

const DEG = Math.PI / 180;

/** 粗网格步长: 每 5 格 / 每 5 行（= 1.8°，游戏里的一个网格单位） */
const MAJOR_STEP = 5;

/** 平面展开图基准宽度: 赤道行 1000 格 → 2 像素 / 格，500 行 → 2 像素 / 行 */
export const PLANET_FLAT_MAP_WIDTH = 2000;

/**
 * 显示细网格的最大相机距离（球半径为 1）:
 * 0.36° 的格子在这个距离上大约 3 像素宽，再远就挤成一片糊，不如不画
 */
export const PLANET_FINE_GRID_MAX_DISTANCE = 2.2;

/**
 * 这一行的**下边界**离赤道有几行: 北半球 0、1、2…，南半球 -1、-2…
 * （粗纬线画在下边界上，所以要按边界算，不能直接用 fromEquator —— 南半球第 0 行的
 *  下边界是赤道以南 0.36°，不是赤道）
 */
function boundaryRowOf(row) {
  return row.north ? row.fromEquator : -(row.fromEquator + 1);
}

/**
 * 经度（度）→ 展开图列（画布 x）
 *
 * 展开图的约定与戴森球那张一致: 左边缘 = 经度 0°，正中 = 180°，右边缘 = 360°（又是 0°）。
 * 注意**不能**拿格号当列号 —— 地基网格的格号是镜像的（东半圈 0 → 180，西半圈 -180 → 0），
 * 直接按格号排会把西半圈画反（镜像）。
 */
function lngToColumn(lng, w) {
  return ((((lng % 360) + 360) % 360) / 360) * w;
}

/** 网格线沿经度的细分步长（度）: 与戴森球经纬线网格同一档（那边是 2°） */
const GRID_LINE_LON_STEP = 2;

/**
 * 生成 3D 网格线（单位球面、游戏局部坐标；调用方按预览惯例把 z 取反）
 *
 * 每一行贡献两组点: 下边界、上边界（上边界就是这个格子的另一头，所以经线不用跟邻行共享顶点）。
 * 纬线画在每行的**下边界**上 —— 相邻两行共用一条边界，这样每条边界正好画一次
 * （赤道由北半球第 0 行画，两极退化成点、跳过）。
 *
 * 每个格子沿经度再按 GRID_LINE_LON_STEP 细分若干段: 否则一格就是一根直弦，
 * 极圈那几行一格 18°，纬线看起来会是一段段直线而不是贴着球面的圆弧
 * （戴森球经纬线网格同样做了这层细分）。
 *
 * @param {object} grid createPlanetGrid() 的返回值
 * @returns {{positions:Float32Array, lineIndices:Uint32Array, lineIndicesMajor:Uint32Array}}
 *   positions 单位球面顶点，lineIndices 全部格子边界，lineIndicesMajor 粗线（前者的子集）
 */
export function buildPlanetGridLines(grid) {
  const rows = grid.rows;
  // 每行的每个格子沿经度细分几段（赤道一格 0.36° → 1 段；极圈一格 18° → 9 段）
  const subdivOf = rows.map((row) => Math.max(1, Math.ceil(360 / row.cells / GRID_LINE_LON_STEP)));

  let vertexTotal = 0;
  for (let r = 0; r < rows.length; r += 1) vertexTotal += 2 * (rows[r].cells * subdivOf[r] + 1);
  const positions = new Float32Array(vertexTotal * 3);
  const lineIndices = [];
  const lineIndicesMajor = [];
  let v = 0;

  for (let r = 0; r < rows.length; r += 1) {
    const row = rows[r];
    const cells = row.cells;
    const half = Math.trunc(cells / 2);
    const cellAngle = 360 / cells;
    const nLon = subdivOf[r];
    const bottom = v;
    const rowLen = cells * nLon + 1; // 一条边界折线的点数（含 +180° 那个端点）

    // 写一条边界折线: 经度从 -180° 单调递增到 +180°，格边界之间再插 nLon-1 个细分点。
    // 不能按「镜像格号」的顺序排顶点: 那样 +180° 的下一格会接回 -0.36°，
    // 纬线就会横穿球面（看起来像 0° 直连 180° 的错误连线）
    const writeBoundary = (latDeg) => {
      const sinLat = Math.sin(latDeg * DEG);
      const cosLat = Math.cos(latDeg * DEG);
      const step = (cellAngle * DEG) / nLon;
      for (let i = 0; i < cells; i += 1) {
        const lng0 = ((i - half) * cellAngle) * DEG;
        for (let k = 0; k < nLon; k += 1) {
          const lng = lng0 + step * k;
          positions[v * 3] = cosLat * Math.sin(lng);
          positions[v * 3 + 1] = sinLat;
          positions[v * 3 + 2] = -cosLat * Math.cos(lng);
          v += 1;
        }
      }
      // 末点: +180°
      positions[v * 3] = cosLat * Math.sin(Math.PI);
      positions[v * 3 + 1] = sinLat;
      positions[v * 3 + 2] = -cosLat * Math.cos(Math.PI);
      v += 1;
    };

    writeBoundary(row.latLo);
    const top = v;
    writeBoundary(row.latHi);

    // 纬线: 这一行的下边界（极点那圈退化成一个点），整条边界一起粗或一起细
    if (Math.abs(row.latLo) < 90) {
      const major = boundaryRowOf(row) % MAJOR_STEP === 0;
      for (let a = bottom; a < bottom + rowLen - 1; a += 1) {
        lineIndices.push(a, a + 1);
        if (major) lineIndicesMajor.push(a, a + 1);
      }
    }

    // 经线: 每个格边界一条（取该格的第一个细分点），每 5 格一条粗线
    // （格号 = 边界离本初子午线几格，东西两半圈对称）
    for (let i = 0; i <= cells; i += 1) {
      const a = bottom + i * nLon;
      const b = top + i * nLon;
      lineIndices.push(a, b);
      if (Math.abs(i - half) % MAJOR_STEP === 0) lineIndicesMajor.push(a, b);
    }
  }

  return {
    positions,
    lineIndices: Uint32Array.from(lineIndices),
    lineIndicesMajor: Uint32Array.from(lineIndicesMajor),
  };
}

/**
 * 在画布上画行星地基网格的平面展开图（背景透明，只有网格线）
 * @param {HTMLCanvasElement} canvas 目标画布（尺寸由本函数设置）
 * @param {object} grid createPlanetGrid() 的返回值
 * @param {number} [scale=1] 相对基准尺寸 2000×1000 的倍数
 * @returns {number} 画出的宽度；0 = 失败
 */
export function drawPlanetGridFlatMap(canvas, grid, scale = 1) {
  if (!canvas) return 0;
  const w = PLANET_FLAT_MAP_WIDTH * Math.max(1, Math.round(scale));
  const h = w / 2;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return 0;
  ctx.clearRect(0, 0, w, h);

  const rowH = h / grid.latitudeCount;
  // 两档: 细线（每格）+ 粗线（每 5 格 / 每 5 行）。一档一个 path 再一次 fill，
  // 重叠的线不会叠加加深（nonzero 填充规则）
  const passes = [
    { step: 1, color: 'rgba(255, 255, 255, 0.20)' },
    { step: MAJOR_STEP, color: 'rgba(255, 255, 255, 0.72)' },
  ];
  for (const pass of passes) {
    ctx.fillStyle = pass.color;
    ctx.beginPath();
    for (const row of grid.rows) {
      const cells = row.cells;
      const half = Math.trunc(cells / 2);
      const cellAngle = 360 / cells;
      const yTop = ((90 - row.latHi) / 180) * h;
      // 经线: 按经度定位（东边界 +k、西边界 -k，k = 0 是同一根）
      for (let k = 0; k <= half; k += pass.step) {
        ctx.rect(lngToColumn(k * cellAngle, w), yTop, 1, rowH + 1);
        if (k > 0) ctx.rect(lngToColumn(-k * cellAngle, w), yTop, 1, rowH + 1);
      }
      // 纬线: 这一行的下边界（与 3D 一样，每条边界只画一次；极点那圈跳过）
      if (Math.abs(row.latLo) < 90 && boundaryRowOf(row) % pass.step === 0) {
        ctx.rect(0, yTop + rowH - 1, w, 1);
      }
    }
    ctx.fill();
  }
  return w;
}

/**
 * 直接建一张行星地基网格的展开图（给预览与导出用）
 * @param {object} grid createPlanetGrid() 的返回值
 * @param {number} [scale=1]
 * @returns {HTMLCanvasElement|null}
 */
export function createPlanetGridFlatMap(grid, scale = 1) {
  if (!grid) return null;
  const canvas = document.createElement('canvas');
  return drawPlanetGridFlatMap(canvas, grid, scale) ? canvas : null;
}

// ─── 地基涂色 ─────────────────────────────────────────────────

/** 未铺地基的色号（与 encoder 的 FOUNDATION_NO_COLOR 一致） */
const NO_COLOR = 255;

/**
 * 折线近似纬线时的矢高上限（单位球半径的比例）
 *
 * 弦到圆弧的矢高 ≈ R·(1 − cos(Δλ/2))（R = cos 纬度 = 该纬度圈到地轴的半径）,
 * 按它定每一小段的经度跨度即可。注意不能只看弦长: 弦长正比于 R，高纬度 R 小，
 * 同样弦长对应的经度跨度大得多、矢高反而更大。
 *
 * 相邻行的切点表是共用的（见 boundaryCuts），所以矢高不再影响「有没有缝」，
 * 只影响两件事: 涂色层会不会凹到遮挡球里面（涂色层抬高 0.0015，矢高远小于它），
 * 以及球面看起来够不够圆。取 3e-4 时赤道一小段约 3°、极圈约 33°（再被下面的硬上限截住）。
 */
const MAX_SUBDIV_SAG = 3e-4;

/**
 * 一小段的经度跨度硬上限（度）
 * 极地附近的扇形用平面三角形近似，面积误差 1 − sin(Δλ)/Δλ，6° 时约 0.18%，看不出缺角
 */
const MAX_SUBDIV_LNG = 6;

// 顶点色（three 视顶点色为线性空间，先在 sRGB 侧换算，否则颜色会偏亮）
function srgbToLinear(c) {
  const v = Math.min(1, Math.max(0, c / 255));
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/**
 * 一格（或一段同色连续格）的经纬范围
 * @param {object} row 行描述
 * @param {number} x0 起始格号（含）
 * @param {number} x1 结束格号（含）
 * @returns {{lngLo:number, lngHi:number}} 西边界 / 东边界（lngLo < lngHi）
 */
function runBounds(row, x0, x1) {
  const half = Math.trunc(row.cells / 2);
  const cellAngle = 360 / row.cells;
  // 东半圈（x < half）: 格 x 占经度 [x, x+1] 格，格号越大越往东；
  // 西半圈（x ≥ half）: 格 x 占 [-(x-half+1), -(x-half)] 格，格号越大越往西 ——
  // 所以一段的西边界来自 x1、东边界来自 x0（搞反了经度会倒过来，三角形绕序跟着翻，
  // 西半球的格子会被背面剔除掉）
  const lngLo = (x0 < half ? x0 : -(x1 - half + 1)) * cellAngle;
  const lngHi = (x1 < half ? x1 + 1 : -(x0 - half)) * cellAngle;
  return { lngLo, lngHi };
}

/**
 * 该纬度上「一小段经度」的跨度上限（度）
 *
 * 折线近似纬线时，弦到圆弧的矢高 ≈ R·(1 − cos(Δλ/2))（R = cos 纬度 = 该纬度圈到地轴的半径），
 * 按矢高定步长即可; 另加一个经度硬上限，避免极地扇形（面积误差 1 − sin(Δλ)/Δλ）缺角。
 */
function maxLngStep(latDeg) {
  const ringR = Math.max(1e-6, Math.cos(Math.abs(latDeg) * DEG));
  const bySag = (2 * Math.asin(Math.min(1, Math.sqrt((2 * MAX_SUBDIV_SAG) / ringR)))) / DEG;
  return Math.min(bySag, MAX_SUBDIV_LNG);
}

/** 一行的颜色分段: [{ lngLo, lngHi, color }]，按经度升序（-180° → 180°，覆盖整圈） */
function rowRuns(row, index) {
  const half = Math.trunc(row.cells / 2);
  const runs = [];
  let x = 0;
  while (x < row.cells) {
    const ci = index[row.base + x];
    if (ci === NO_COLOR) { x += 1; continue; }
    // 同色连续段: 不许跨过接缝（x = half）
    const limit = x < half ? half : row.cells;
    let end = x + 1;
    while (end < limit && index[row.base + end] === ci) end += 1;
    const { lngLo, lngHi } = runBounds(row, x, end - 1);
    runs.push({ lngLo, lngHi, color: ci });
    x = end;
  }
  runs.sort((a, b) => a.lngLo - b.lngLo);
  return runs;
}

/**
 * 一条纬线（行边界）上的切点表（度，升序）
 *
 * 两侧行都用**同一份**切点表，两行在这条纬线上的折线就完全重合 —— 这是几何严丝合缝的关键:
 * 各算各的会在两条折线之间留下月牙形空洞，空洞在遮挡球内侧、被挡掉深度后露出背景，
 * 就是极地那些细黑线。
 */
function boundaryCuts(latDeg, runsA, runsB) {
  const set = new Set([-180, 0, 180]);
  for (const run of runsA) { set.add(run.lngLo); set.add(run.lngHi); }
  if (runsB !== runsA) for (const run of runsB) { set.add(run.lngLo); set.add(run.lngHi); }
  const base = [...set].sort((a, b) => a - b);

  const step = maxLngStep(latDeg);
  const out = [base[0]];
  for (let i = 0; i < base.length - 1; i += 1) {
    const a = base[i];
    const b = base[i + 1];
    const n = Math.max(1, Math.ceil((b - a) / step));
    for (let k = 1; k <= n; k += 1) out.push(a + ((b - a) * k) / n);
  }
  return out;
}

/**
 * 生成地基涂色的 3D 几何（单位球面、游戏局部坐标；调用方按预览惯例把 z 取反）
 *
 * 同一行里颜色相同的相邻格合并成一条「带子」（整星 32 万格逐格画太费），
 * 但相邻两行在共享纬线上的切点表是**同一份**，而且带子之间是按折线交替缝合的
 * （见 stitch），所以整个曲面严丝合缝 —— 不会出现露出背景的细黑线。
 * 合并不跨过「接缝」: 格号 cells/2 前后分别是 +180° 与 -0.36°，连起来会横穿球面。
 *
 * @param {object} grid createPlanetGrid() 的返回值
 * @param {Array<{r:number,g:number,b:number}>} palette 调色板
 * @param {Uint8Array} index 每格色号（255 = 不铺）
 * @returns {Array<{positions:Float32Array, colors:Float32Array}>|null}
 *   与 paintingGrid.js 的涂色几何同构: colors 每顶点 4 个分量（a = 涂色状态）
 */
export function buildPlanetPaintGeometry(grid, palette, index) {
  if (!grid || !palette?.length || !index) return null;

  const rows = grid.rows;
  const runsOf = rows.map((row) => rowRuns(row, index));

  // 行按纬度从南极排到北极，相邻两项共享一条纬线（前一项的 latHi = 后一项的 latLo）
  const ordered = [];
  for (let i = rows.length - 1; i >= grid.latHalf; i -= 1) ordered.push(rows[i]);
  for (let i = 0; i < grid.latHalf; i += 1) ordered.push(rows[i]);

  // 每条共享纬线的切点表（两侧行共用）
  const between = new Array(Math.max(0, ordered.length - 1));
  for (let i = 0; i + 1 < ordered.length; i += 1) {
    between[i] = boundaryCuts(
      ordered[i].latHi,
      runsOf[ordered[i].row],
      runsOf[ordered[i + 1].row],
    );
  }

  const verts = [];
  const cols = [];
  // 顶点色按调色板预先算好，逐格只查表
  const paletteColors = palette.map((c) => [
    srgbToLinear(c.r), srgbToLinear(c.g), srgbToLinear(c.b), 0.5,
  ]);

  for (let i = 0; i < ordered.length; i += 1) {
    const row = ordered[i];
    const latLo = row.latLo;
    const latHi = row.latHi;
    const runs = runsOf[row.row];
    if (!runs.length) continue;
    const own = boundaryCuts(latLo, runs, runs);
    // 下边界 = 与南侧邻行共享的那条纬线，上边界 = 与北侧邻行共享的那条
    const bottom = i > 0 ? between[i - 1] : own;
    const top = i + 1 < ordered.length ? between[i] : own;

    // 极点是退化边: 让两条折线的经度一一对应，缝合时就自然收成扇形
    const poleLo = latLo <= -90;
    const poleHi = latHi >= 90;
    const lower = poleLo && !poleHi ? top : bottom;
    const upper = poleHi && !poleLo ? bottom : top;

    // 按颜色分段逐段缝合: 每段里两条折线的经度都落在同一个颜色区间内，颜色才是确定的
    for (const run of runs) {
      const rgba = paletteColors[run.color];
      const a = clipCuts(lower, run.lngLo, run.lngHi);
      const b = clipCuts(upper, run.lngLo, run.lngHi);
      if (a.length < 2 || b.length < 2) continue;
      stitch(a, b, latLo, latHi, rgba, verts, cols);
    }
  }

  if (!verts.length) return null;
  return [{ positions: new Float32Array(verts), colors: new Float32Array(cols) }];
}

/** 取出切点表里落在 [lo, hi] 的一段（两端一定在表里，见 boundaryCuts 的定值方式） */
function clipCuts(cuts, lo, hi) {
  const out = [];
  for (const v of cuts) {
    if (v < lo - 1e-9) continue;
    if (v > hi + 1e-9) break;
    out.push(v);
  }
  return out;
}

/**
 * 把一条颜色区间里、上下两条折线之间的带子缝成三角形
 *
 * 两条折线的经度不完全对应（各自的分段位置不同），所以不能用四边形 —— 要像拉链一样
 * 交替推进两侧，保证每条折线的每一段都正好被用一次: 这样左右相邻行、上下相邻带子的
 * 边界都严丝合缝，不会留下露出背景的细缝。
 */
function stitch(lower, upper, latLo, latHi, rgba, verts, cols) {
  const push = (latA, lngA, latB, lngB, latC, lngC) => {
    const p1 = latLngToLocal(latA, lngA);
    const p2 = latLngToLocal(latB, lngB);
    const p3 = latLngToLocal(latC, lngC);
    verts.push(p1[0], p1[1], p1[2], p2[0], p2[1], p2[2], p3[0], p3[1], p3[2]);
    for (let k = 0; k < 3; k += 1) cols.push(rgba[0], rgba[1], rgba[2], rgba[3]);
  };

  const poleLo = latLo <= -90;
  const poleHi = latHi >= 90;

  // 极点那条边退化成一点: 直接收成扇形，不走下面的拉链（否则最后一圈会拉出零面积三角形）
  if (poleHi) {
    for (let k = 0; k + 1 < lower.length; k += 1) {
      push(latLo, lower[k], latLo, lower[k + 1], latHi, lower[k + 1]);
    }
    return;
  }
  if (poleLo) {
    for (let k = 0; k + 1 < upper.length; k += 1) {
      push(latLo, upper[k], latHi, upper[k + 1], latHi, upper[k]);
    }
    return;
  }

  let i = 0;
  let j = 0;
  while (i < lower.length - 1 || j < upper.length - 1) {
    const stepLower = j >= upper.length - 1
      || (i < lower.length - 1 && lower[i + 1] <= upper[j + 1]);
    if (stepLower) {
      push(latLo, lower[i], latLo, lower[i + 1], latHi, upper[j]);
      i += 1;
    } else {
      push(latLo, lower[i], latHi, upper[j + 1], latHi, upper[j]);
      j += 1;
    }
  }
}

/**
 * 把地基涂色画进展开图（同一行里同色的相邻格合并成一个矩形）
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} grid createPlanetGrid() 的返回值
 * @param {Array<{r:number,g:number,b:number}>} palette
 * @param {Uint8Array} index
 * @param {number} w 画布宽
 * @param {number} h 画布高
 * @returns {boolean} 是否画了东西
 */
export function drawPlanetPaintFlatMap(ctx, grid, palette, index, w, h) {
  if (!ctx || !grid || !palette?.length || !index) return false;
  const rowH = h / grid.latitudeCount;
  let painted = false;

  for (const row of grid.rows) {
    const cells = row.cells;
    const yTop = ((90 - row.latHi) / 180) * h;
    let x = 0;
    while (x < cells) {
      const ci = index[row.base + x];
      if (ci === NO_COLOR) { x += 1; continue; }
      let end = x + 1;
      while (end < cells && index[row.base + end] === ci) end += 1;
      const { lngLo, lngHi } = runBounds(row, x, end - 1);
      const c = palette[ci];
      ctx.fillStyle = `rgb(${c.r}, ${c.g}, ${c.b})`;
      // 列按经度定位: 一段的宽度就是它跨的经度（+0.5 像素避免相邻格子之间留缝）
      ctx.fillRect(
        lngToColumn(lngLo, w),
        yTop,
        ((lngHi - lngLo) / 360) * w + 0.5,
        rowH + 0.5,
      );
      painted = true;
      x = end;
    }
  }
  return painted;
}
