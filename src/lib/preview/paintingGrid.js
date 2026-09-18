import * as THREE from 'three';
// 测地线资产表
let geoAssetsPromise = null;
function loadGeoAssets() {
  return geoAssetsPromise ??= import('./paintingGridAssets.js');
}
/**
 * paintingGrid — 戴森球蓝图「涂色网格」(fillGrid) 生成模块
 *
 * 经纬线网格 (gridType 0) —— 已通过真实蓝图数据 + 游戏本体网格资产双重验证:
 *   - 120 个纬度带（各 1.5°），带序号 latIdx ∈ [-60, 59]，从南向北编号
 *   - 每带经向分段数 = GetSegByLatitudeIdx(带的最靠赤道一侧的纬度序号)，
 *     即南半球带取 (latIdx+1)（北缘），北半球带取 latIdx（南缘）
 *   - 格子序号 = 带内累计偏移 + 带内经向序号（南半球优先，经度最快索引）
 *   - 从游戏 resources.assets 提取的 dyson-grid-graticule-painting 网格
 *     18304 个格子与本公式逐格比对全部一致 (18304/18304)
 *
 * 测地线网格 (gridType 1/2/3 = geo20/geo8/geo4):
 *   从游戏本体提取的精确网格数据。格子 = 三角形，格子编号 = 网格三角形序号
 *   （与游戏 PickColorFromCell 的 cellColors[triId] 一致）。
 *   结构: geo20 = 正二十面体 20×24² 三角形，
 *   geo8 = 正八面体 8×48²，geo4 = 正四面体 4×72²。
 */

// three r152+ 视顶点色为线性空间、输出时再做 sRGB 编码，故需先 sRGB→线性，否则颜色二次提亮（发白）
function srgbToLinear(c) {
  c = Math.min(1, Math.max(0, c));
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

// 涂色颜色 → 顶点色 (r,g,b 线性, a)
function paintToVertexColor(c, alpha) {
  return [srgbToLinear(c.r / 255), srgbToLinear(c.g / 255), srgbToLinear(c.b / 255), alpha];
}

// 超亮涂色的加色发光强度: 总亮度 = 基础色 1 + 发光 0.2 = 1.2× 存储颜色
const BRIGHT_GLOW_STRENGTH = 0.2;

// ─── 经纬线网格常量 ───

// segmentTable: DetermineLongitudeSegmentCount 的量化查找表
const SEGMENT_TABLE = [
  1,4,4,4,4,4,4,4,8,8, 8,8,8,8,8,8,16,16,16,16,
  20,20,20,20,20,20,20,20,32,32, 32,32,32,32,32,32,32,32,32,32,
  40,40,40,40,40,40,40,40,40,40, 40,40,40,40,60,60,60,60,60,60,
  60,60,60,60,60,60,60,60,60,60, 60,60,60,80,80,80,80,80,80,80,
  80,80,80,80,80,80,80,80,80,80, 80,100,100,100,100,100,100,100,100,100,
  100,100,100,100,100,100,100,100,100,100, 100,100,100,100,120,120,120,120,120,120,
  120,120,120,120,120,120,120,120,120,120, 120,120,120,120,120,120,120,120,120,120,
  160,160,160,160,160,160,160,160,160,160, 160,160,160,160,160,160,160,160,160,160,
  160,160,160,160,160,160,160,160,160,160, 160,160,160,160,160,160,160,160,200,200,
  200,200,200,200,200,200,200,200,200,200, 200,200,200,200,200,200,200,200,200,200,
  200,200,200,200,200,200,200,200,200,200, 200,200,200,200,200,200,200,200,200,200,
  200,200,200,200,200,200,200,200,200,200, 200,240,240,240,240,240,240,240,240,240,
  240,240,240,240,240,240,240,240,240,240, 240,240,240,240,240,240,240,240,240,240,
  240,240,240,240,240,240,240,240,240,240, 240,240,240,240,240,240,240,240,240,240,
  240,240,240,240,240,240,240,240,240,240, 240,300,300,300,300,300,300,300,300,300,
  300,300,300,300,300,300,300,300,300,300, 300,300,300,300,300,300,300,300,300,300,
  300,300,300,300,300,300,300,300,300,300, 300,300,300,300,300,300,300,300,300,300,
  300,300,300,300,300,300,300,300,300,300, 300,300,300,300,300,300,300,300,300,300,
  300,400,400,400,400,400,400,400,400,400, 400,400,400,400,400,400,400,400,400,400,
  400,400,400,400,400,400,400,400,400,400, 400,400,400,400,400,400,400,400,400,400,
  400,400,400,400,400,400,400,400,400,400, 400,400,400,400,400,400,400,400,400,400,
  400,400,400,400,400,400,400,400,400,400, 400,400,400,400,400,400,400,400,400,400,
  400,400,400,400,400,400,400,400,400,400, 400,400,400,400,400,400,400,400,400,400,
  400,400,400,400,400,400,400,400,400,400, 400,500,500,500,500,500,500,500,500,500,
  500,500,500,500,500,500,500,500,500,500, 500,500,500,500,500,500,500,500,500,500,
  500,500,500,500,500,500,500,500,500,500, 500,500
];

function determineLongitudeSegmentCount(latitudeIndex, segment = 60) {
  let num = Math.ceil(Math.abs(Math.cos(latitudeIndex / (segment / 4) * Math.PI * 0.5)) * segment);
  if (num < 500) return SEGMENT_TABLE[num];
  return Math.floor((num + 49) / 100) * 100;
}

function segByLatIdx(latIdx, latHalf = 60) {
  let num = latIdx / latHalf * 90;
  num = Math.ceil(Math.max(0, Math.abs(num) + 0.1));
  const num2 = num * Math.PI / 180 / (2 * Math.PI) * 60;
  const idx = Math.floor(Math.max(0, Math.abs(num2) - 0.1));
  return determineLongitudeSegmentCount(idx, 60) * 4;
}

// ─── 经纬线网格 ──────────────────────────────────────────────

// 计算经纬线网格的带结构（从南向北），返回 [{ latIdx, latLo, latHi, seg, base }]
function buildGraticuleBands() {
  const latHalf = determineLongitudeSegmentCount(0, 60) * 4 / 4; // = 60
  const bands = [];
  let base = 0;
  for (let latIdx = -latHalf; latIdx < latHalf; latIdx += 1) {
    // 分段数取该带最靠赤道一侧的纬度序号: 南半球取北缘 latIdx+1，北半球取南缘 latIdx
    const seg = segByLatIdx(latIdx < 0 ? latIdx + 1 : latIdx, latHalf);
    bands.push({
      latIdx,
      latLo: latIdx * 1.5,
      latHi: (latIdx + 1) * 1.5,
      seg,
      base,
    });
    base += seg;
  }
  return bands;
}

// 经纬度 → 游戏局部坐标: 纬度 asin(y)、经度 0 = -Z 方向、东 = +X
function latLngToLocal(latDeg, lngDeg) {
  const lat = latDeg * Math.PI / 180;
  const lng = lngDeg * Math.PI / 180;
  const cosLat = Math.cos(lat);
  return [
    cosLat * Math.sin(lng),
    Math.sin(lat),
    -cosLat * Math.cos(lng),
  ];
}

// 游戏局部坐标 → 经纬度（度）: lat = asin(y)，lng = atan2(x, -z)
function localToLatLng(x, y, z) {
  const r = Math.max(1e-9, Math.hypot(x, y, z));
  return {
    lat: Math.asin(Math.max(-1, Math.min(1, y / r))) * 180 / Math.PI,
    lng: Math.atan2(x, -z) * 180 / Math.PI,
  };
}

/**
 * 生成经纬线网格的涂色几何
 * @param {Array} colors - 18304 格涂色数据（下标 = 游戏格子序号）
 * @returns {Array|null} [{ positions: Float32Array, colors: Float32Array(RGBA 0-1), additive: bool }]
 */
function buildGraticuleGeometry(colors) {
  const bands = buildGraticuleBands();
  const verts = [];
  const cols = [];
  const vertsBrightBase = [];
  const colsBrightBase = [];
  const vertsBrightGlow = [];
  const colsBrightGlow = [];

  for (const band of bands) {
    const step = 360 / band.seg;
    // 细分经度边: 平面四边形两极处下沉 ~1.9%，远超涂色层抬高的 0.15% → 会出现缝隙；细分后 ≤0.015%
    const m = Math.max(1, Math.ceil(step / 2));
    for (let li = 0; li < band.seg; li += 1) {
      const idx = band.base + li;
      const c = idx < colors.length ? colors[idx] : null;
      if (!c || c.a <= 0) continue;

      const lngLo = li * step;
      // 绕序: 经预览变换（轨道四元数 + z 翻转）后法线朝外，配合 FrontSide 单面渲染
      // a 通道不是透明度: a>0 即已涂色（RGB 已按笔刷强度缩放，完全不透明）；a>127 为超亮，强度 =(a-127)/128
      const bright = c.a > 127;
      const rgba = paintToVertexColor(c, 1);
      const glowA = (c.a - 127) / 128 * BRIGHT_GLOW_STRENGTH;
      const glow = [rgba[0], rgba[1], rgba[2], glowA];
      for (let j = 0; j < m; j += 1) {
        const lngA = lngLo + (j * step) / m;
        const lngB = lngLo + ((j + 1) * step) / m;
        const corners = [
          latLngToLocal(band.latLo, lngA),
          latLngToLocal(band.latLo, lngB),
          latLngToLocal(band.latHi, lngB),
          latLngToLocal(band.latHi, lngA),
        ];
        // 极点带退化边只保留有效三角形
        const tri = band.latLo <= -90 ? [0, 2, 3] : band.latHi >= 90 ? [0, 1, 2] : [0, 1, 2, 0, 2, 3];
        if (bright) {
          for (const vi of tri) {
            vertsBrightBase.push(...corners[vi]);
            colsBrightBase.push(...rgba);
            vertsBrightGlow.push(...corners[vi]);
            colsBrightGlow.push(...glow);
          }
        } else {
          for (const vi of tri) {
            verts.push(...corners[vi]);
            cols.push(...rgba);
          }
        }
      }
    }
  }

  const result = [];
  if (verts.length) result.push({ positions: new Float32Array(verts), colors: new Float32Array(cols), additive: false });
  if (vertsBrightBase.length) result.push({ positions: new Float32Array(vertsBrightBase), colors: new Float32Array(colsBrightBase), additive: false });
  if (vertsBrightGlow.length) result.push({ positions: new Float32Array(vertsBrightGlow), colors: new Float32Array(colsBrightGlow), additive: true });
  return result.length ? result : null;
}

// ─── 测地线网格 (geo4 / geo8 / geo20) ───

const GEO_ASSET_KEYS = {
  1: 'dyson-grid-geo20',
  2: 'dyson-grid-geo8',
  3: 'dyson-grid-geo4',
};

const geoAssetCache = new Map();

async function getGeoAsset(gridType) {
  const key = GEO_ASSET_KEYS[gridType];
  if (!key) return null;
  if (!geoAssetCache.has(gridType)) {
    const { GRID_ASSETS, decodeGridAsset } = await loadGeoAssets();
    const entry = GRID_ASSETS[key];
    if (!entry) return null;
    geoAssetCache.set(gridType, decodeGridAsset(entry));
  }
  return geoAssetCache.get(gridType);
}

// 生成测地线网格涂色几何
async function buildGeoGeometry(fillGrid) {
  const colors = fillGrid.colors;
  const asset = await getGeoAsset(fillGrid.gridType);
  if (!asset) return null;
  const nTris = asset.indices.length / 3;

  if (colors.length < nTris) return null;

  const pos = asset.positions;
  const idx = asset.indices;
  const verts = [];
  const cols = [];
  const vertsBrightBase = [];
  const colsBrightBase = [];
  const vertsBrightGlow = [];
  const colsBrightGlow = [];

  for (let t = 0; t < nTris; t += 1) {
    const c = t < colors.length ? colors[t] : null;
    if (!c || c.a <= 0) continue;
    // a 通道不是透明度: a>0 即已涂色（完全不透明），a>127 为超亮涂色
    const bright = c.a > 127;
    const rgba = paintToVertexColor(c, 1);
    const glowA = (c.a - 127) / 128 * BRIGHT_GLOW_STRENGTH;
    const glow = [rgba[0], rgba[1], rgba[2], glowA];
    // 顶点逆序（翻转绕序）: 经 z 翻转后法线朝外，配合 FrontSide 单面渲染
    for (let k = 2; k >= 0; k -= 1) {
      const vi = idx[t * 3 + k];
      const px = pos[vi * 3], py = pos[vi * 3 + 1], pz = pos[vi * 3 + 2];
      if (bright) {
        vertsBrightBase.push(px, py, pz);
        colsBrightBase.push(...rgba);
        vertsBrightGlow.push(px, py, pz);
        colsBrightGlow.push(...glow);
      } else {
        verts.push(px, py, pz);
        cols.push(...rgba);
      }
    }
  }

  const result = [];
  if (verts.length) result.push({ positions: new Float32Array(verts), colors: new Float32Array(cols), additive: false });
  if (vertsBrightBase.length) result.push({ positions: new Float32Array(vertsBrightBase), colors: new Float32Array(colsBrightBase), additive: false });
  if (vertsBrightGlow.length) result.push({ positions: new Float32Array(vertsBrightGlow), colors: new Float32Array(colsBrightGlow), additive: true });
  return result.length ? result : null;
}

/**
 * 生成涂色网格几何
 * @param {object} fillGrid - 解析后的 fillGrid: { gridType, colors }
 * @returns {Promise<Array|null>} [{ positions: Float32Array, colors: Float32Array(RGBA 0-1), additive: bool }]
 */
async function buildPaintingGeometry(fillGrid) {
  if (!fillGrid || !fillGrid.colors) return null;
  if (fillGrid.gridType === 0) {
    return buildGraticuleGeometry(fillGrid.colors);
  }
  return buildGeoGeometry(fillGrid);
}

// 经纬线网格: 由带结构生成网格线顶点（单位球面、游戏局部坐标）+ 粗细两档的线段索引
function buildGraticuleLines(lonStepDeg = 2) {
  const positions = [];
  const lineIndices = [];
  const lineIndicesMajor = [];

  for (const band of buildGraticuleBands()) {
    // 剖分数必须与涂色层的 m = ceil(格宽/2) 一致（用 round 会少分一段 → 下沉更多、线掉到涂色面下面）
    const nLon = Math.max(1, Math.ceil(360 / band.seg / lonStepDeg));
    const rows = [];
    for (const latIdx of [band.latIdx, band.latIdx + 1]) {
      const lat = Math.max(-90, Math.min(90, latIdx * 1.5));
      const row = [];
      for (let li = 0; li <= band.seg * nLon; li += 1) {
        const lng = (li / (band.seg * nLon)) * 360;
        row.push(positions.length / 3);
        const p = latLngToLocal(lat, lng);
        positions.push(p[0], p[1], p[2]);
      }
      rows.push(row);
    }
    // 网格线只画格子边界: 纬线逐段折线、经线每格一条，每 4 格一条粗线。
    // 纬度边界 1.5°×k 既是带 k 的下边、也是带 k-1 的上边，两者同档且几乎重合 → 只画 rows[0]。
    const cols = band.seg * nLon;
    if (band.latLo > -90) {
      const dst = band.latIdx % 4 === 0 ? lineIndicesMajor : lineIndices;
      for (let li = 0; li < cols; li += 1) dst.push(rows[0][li], rows[0][li + 1]);
    }
    // 经线: 各带剖分不同、不能跨带合并，每带每格一条
    for (let li = 0; li < band.seg; li += 1) {
      const c = li * nLon;
      const dst = li % 4 === 0 ? lineIndicesMajor : lineIndices;
      dst.push(rows[0][c], rows[1][c]);
    }
  }

  return {
    positions: new Float32Array(positions),
    lineIndices: new Uint32Array(lineIndices),
    lineIndicesMajor: new Uint32Array(lineIndicesMajor),
  };
}

// 球面网格: 顶点用游戏经纬度约定（经度 0° = -Z，东 = +X，+Y 为北极），与经纬线网格同源，不存在缝/方向错位
function buildSphere(lonSegments = 180, latSegments = 90) {
  const positions = new Float32Array((lonSegments + 1) * (latSegments + 1) * 3);
  const indices = new Uint32Array(lonSegments * latSegments * 6);
  let vi = 0;
  for (let iy = 0; iy <= latSegments; iy += 1) {
    const lat = (iy / latSegments) * 180 - 90;
    for (let ix = 0; ix <= lonSegments; ix += 1) {
      const p = latLngToLocal(lat, (ix / lonSegments) * 360);
      positions[vi] = p[0];
      positions[vi + 1] = p[1];
      positions[vi + 2] = p[2];
      vi += 3;
    }
  }
  let ii = 0;
  for (let iy = 0; iy < latSegments; iy += 1) {
    for (let ix = 0; ix < lonSegments; ix += 1) {
      const a = iy * (lonSegments + 1) + ix;
      const b = a + lonSegments + 1;
      // 绕序: 逆时针朝外（法线朝球外），外面可见
      indices[ii] = a;
      indices[ii + 1] = b + 1;
      indices[ii + 2] = a + 1;
      indices[ii + 3] = a;
      indices[ii + 4] = b;
      indices[ii + 5] = b + 1;
      ii += 6;
    }
  }
  return { positions, indices };
}

export {
  buildGraticuleGeometry,
  buildPaintingGeometry,
  buildGraticuleBands,
  buildGraticuleLines,
  buildSphere,
  latLngToLocal,
  localToLatLng,
  segByLatIdx,
};
