/**
 * planetGrid.js — 行星地基网格模型
 *
 * 只负责网格本身: 行列结构、格子序号 ↔ 经纬度 ↔ 三维方向、遍历。
 * 图片采样 / 地基蓝图编码 / 预览由下游模块使用。
 *
 * 半径 200 → segment 200 的结构:
 *   - 一行 = 360/(segment×5) 度（0.36°），每 5 行一个「纬度档」latIdx；赤道 → 极点 250 行
 *   - 行号 0…249 从赤道往北、250…499 从赤道往南，两个半球都按「离赤道的行数」计档
 *   - 每行格数 = DetermineLongitudeSegmentCount(latIdx, segment) × 5（赤道行 1000 格）
 *   - 格号 x 是镜像排布: x < cells/2 从经度 0 往东、x ≥ cells/2 往西（经度 0 在接缝上）
 *   - 格中心落在半格上（±(离赤道行数 + 0.5) × 行跨度），格子边界才是整数
 *
 * 坐标与 paintingGrid.js 一致（纬度 = asin(y)、经度 0° = -Z、东 = +X）。
 * 对外经纬度一律用度，内部再换算成游戏的弧度 / 网格单位。
 */

/** 行星默认半径: 游戏里可铺地基的行星恒为 200（PlanetGen.cs → planetData.radius = 200f） */
export const DEFAULT_PLANET_RADIUS = 200;

const DEG = Math.PI / 180;

// segmentTable: DetermineLongitudeSegmentCount 的量化查找表（游戏 PlanetGrid.segmentTable）
export const SEGMENT_TABLE = [
  1, 4, 4, 4, 4, 4, 4, 4, 8, 8,
  8, 8, 8, 8, 8, 8, 16, 16, 16, 16,
  20, 20, 20, 20, 20, 20, 20, 20, 32, 32,
  32, 32, 32, 32, 32, 32, 32, 32, 32, 32,
  40, 40, 40, 40, 40, 40, 40, 40, 40, 40,
  40, 40, 40, 40, 60, 60, 60, 60, 60, 60,
  60, 60, 60, 60, 60, 60, 60, 60, 60, 60,
  60, 60, 60, 80, 80, 80, 80, 80, 80, 80,
  80, 80, 80, 80, 80, 80, 80, 80, 80, 80,
  80, 100, 100, 100, 100, 100, 100, 100, 100, 100,
  100, 100, 100, 100, 100, 100, 100, 100, 100, 100,
  100, 100, 100, 100, 120, 120, 120, 120, 120, 120,
  120, 120, 120, 120, 120, 120, 120, 120, 120, 120,
  120, 120, 120, 120, 120, 120, 120, 120, 120, 120,
  160, 160, 160, 160, 160, 160, 160, 160, 160, 160,
  160, 160, 160, 160, 160, 160, 160, 160, 160, 160,
  160, 160, 160, 160, 160, 160, 160, 160, 160, 160,
  160, 160, 160, 160, 160, 160, 160, 200, 200, 200,
  200, 200, 200, 200, 200, 200, 200, 200, 200, 200,
  200, 200, 200, 200, 200, 200, 200, 200, 200, 200,
  200, 200, 200, 200, 200, 200, 200, 200, 200, 200,
  200, 200, 200, 200, 200, 200, 200, 200, 200, 200,
  200, 240, 240, 240, 240, 240, 240, 240, 240, 240,
  240, 240, 240, 240, 240, 240, 240, 240, 240, 240,
  240, 240, 240, 240, 240, 240, 240, 240, 240, 240,
  240, 240, 240, 240, 240, 240, 240, 240, 240, 240,
  240, 240, 240, 240, 240, 240, 240, 240, 240, 240,
  240, 300, 300, 300, 300, 300, 300, 300, 300, 300,
  300, 300, 300, 300, 300, 300, 300, 300, 300, 300,
  300, 300, 300, 300, 300, 300, 300, 300, 300, 300,
  300, 300, 300, 300, 300, 300, 300, 300, 300, 300,
  300, 300, 300, 300, 300, 300, 300, 300, 300, 300,
  300, 300, 300, 300, 300, 300, 300, 300, 300, 300,
  300, 300, 300, 300, 300, 300, 300, 300, 300, 300,
  300, 300, 300, 300, 300, 300, 300, 300, 300, 300,
  300, 400, 400, 400, 400, 400, 400, 400, 400, 400,
  400, 400, 400, 400, 400, 400, 400, 400, 400, 400,
  400, 400, 400, 400, 400, 400, 400, 400, 400, 400,
  400, 400, 400, 400, 400, 400, 400, 400, 400, 400,
  400, 400, 400, 400, 400, 400, 400, 400, 400, 400,
  400, 400, 400, 400, 400, 400, 400, 400, 400, 400,
  400, 400, 400, 400, 400, 400, 400, 400, 400, 400,
  400, 400, 400, 400, 400, 400, 400, 400, 400, 400,
  400, 400, 400, 400, 400, 400, 400, 400, 400, 400,
  400, 400, 400, 400, 400, 400, 400, 400, 400, 400,
  400, 500, 500, 500, 500, 500, 500, 500, 500, 500,
  500, 500, 500, 500, 500, 500, 500, 500, 500, 500,
  500, 500, 500, 500, 500, 500, 500, 500, 500, 500,
  500, 500, 500, 500, 500, 500, 500, 500, 500, 500,
  500, 500, 500, 500, 500, 500, 500, 500, 500, 500,
  500, 500, 500, 500, 500, 500, 500, 500, 500, 500,
  500, 500,
];

/**
 * 该纬度档的经度分段数（游戏 PlanetGrid.DetermineLongitudeSegmentCount）
 * @param {number} latitudeIndex 纬度档序号 = floor(离赤道的行数 / 5)
 * @param {number} [segment] 网格 segment（见 planetGridSegment）
 * @returns {number} 该行格数 = 返回值 × 5
 */
export function determineLongitudeSegmentCount(latitudeIndex, segment = DEFAULT_PLANET_RADIUS) {
  const num = Math.ceil(Math.abs(Math.cos((latitudeIndex / (segment / 4)) * Math.PI * 0.5)) * segment);
  if (num < 500) return SEGMENT_TABLE[num];
  return Math.floor((num + 49) / 100) * 100;
}

/**
 * 行星半径 → 网格 segment = trunc(radius/4 + 0.1) × 4（游戏 PlanetAuxData 同款）
 * @param {number} [radius]
 * @returns {number}
 */
export function planetGridSegment(radius = DEFAULT_PLANET_RADIUS) {
  const r = Number(radius);
  const value = Number.isFinite(r) && r > 0 ? r : DEFAULT_PLANET_RADIUS;
  // 至少 4: 半径过小时 (int)(radius / 4 + 0.1) * 4 会算成 0，网格退化没有意义
  return Math.max(4, Math.trunc(value / 4 + 0.1) * 4);
}

/**
 * 一行 / 一格在纬度方向的跨度（度）: 5 行 = 1 个纬度档，赤道档跨度 = 360 / segment
 * @param {number} [radius]
 * @returns {number} 半径 200 → 0.36
 */
export function planetRowLat(radius = DEFAULT_PLANET_RADIUS) {
  return 360 / (planetGridSegment(radius) * 5);
}

/**
 * 建立行星地基网格模型
 * @param {number} [radius] 行星半径（游戏里恒为 200，留参数是为了对齐其它半径的数据）
 * @returns {{
 *   radius:number, segment:number, equatorSegments:number,
 *   rowLat:number, latHalf:number, latitudeCount:number, total:number,
 *   rows:Array<{row:number, north:boolean, fromEquator:number, latIdx:number,
 *               segCount:number, cells:number, base:number, latLo:number, latHi:number}>,
 *   rowAt:(index:number)=>object|null,
 *   cellOfIndex:(index:number)=>{row:number,x:number}|null,
 *   cellIndexOf:(row:number,x:number)=>number,
 *   cellLatLng:(index:number)=>{lat:number,lng:number}|null,
 *   cellDirection:(index:number)=>number[]|null,
 *   indexOfLatLng:(lat:number,lng:number)=>number,
 *   snapCell:(lat:number,lng:number)=>{index:number,row:number,x:number,lat:number,lng:number}|null,
 *   forEachRow:(fn:(row:object)=>void)=>void,
 *   forEachCell:(fn:(index:number,row:number,x:number,lat:number,lng:number)=>void)=>void,
 * }}
 */
export function createPlanetGrid(radius = DEFAULT_PLANET_RADIUS) {
  const segment = planetGridSegment(radius);
  // 赤道档的经度分段数: 游戏 latitudeCount = DetermineLongitudeSegmentCount(0, segment) * 5 / 2
  const equatorSegments = determineLongitudeSegmentCount(0, segment);
  const latitudeCount = Math.trunc((equatorSegments * 5) / 2);
  const latHalf = Math.trunc(latitudeCount / 2);
  // 一行 / 一格的角跨度（度）: 经向 5 行 = 1 个纬度档，赤道档的纬度档跨度 = 360 / segment
  const rowLat = planetRowLat(radius);
  // 纬度方向的网格单位上限（= 赤道 → 极点的档数 × 5 行，也是游戏的 latitudeCount / 10）
  const latLimit = Math.trunc(latitudeCount / 10);

  // 行表: base = 该行首格序号（= 游戏 PlatformSystem.reformOffsets）
  const rows = new Array(latitudeCount);
  let total = 0;
  for (let row = 0; row < latitudeCount; row += 1) {
    const north = row < latHalf;
    // 离赤道的行数: 两个半球各自从 0 起算（游戏 ComputeMaxReformCount 的分档方式）
    const fromEquator = north ? row : row - latHalf;
    const latIdx = Math.trunc(fromEquator / 5);
    const segCount = determineLongitudeSegmentCount(latIdx, segment);
    const cells = segCount * 5;
    const lo = fromEquator * rowLat;
    rows[row] = {
      row,
      north,
      fromEquator,
      latIdx,
      segCount,
      cells,
      base: total,
      // 行的纬度范围（度，latLo < latHi，南半球为负）
      latLo: north ? lo : -lo - rowLat,
      latHi: north ? lo + rowLat : -lo,
    };
    total += cells;
  }

  /** 该行的一半格数（= 游戏里的 cells / 2，整数除法） */
  function halfCells(row) {
    return Math.trunc(row.cells / 2);
  }

    /** 格子序号 → 所在行（越界 → null） */
  function rowAt(index) {
    if (!Number.isInteger(index) || index < 0 || index >= total) return null;
    // 行首偏移递增，二分找最后一个 base ≤ index 的行
    let lo = 0;
    let hi = latitudeCount - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (rows[mid].base <= index) lo = mid;
      else hi = mid - 1;
    }
    return rows[lo];
  }

    /** 格子序号 → { row, x }（x = 行内经度格号；越界 → null） */
  function cellOfIndex(index) {
    const row = rowAt(index);
    return row ? { row: row.row, x: index - row.base } : null;
  }

  /** (行, 行内经度格号) → 格子序号: 格号超出该行会绕回（经度是环）；行号非法 → -1 */
  function cellIndexOf(row, x) {
    const r = rows[row];
    if (!r) return -1;
    const wrapped = ((Math.trunc(x) % r.cells) + r.cells) % r.cells;
    return r.base + wrapped;
  }

    /**
     * 格子序号 → 格中心经纬度（度），与游戏 GetLatAndLngRadByGridId 逐格一致:
     * 纬度 = ±(离赤道行数 + 0.5) × 行跨度，经度 = (x < cells/2 ? x + 0.5 : cells/2 - x - 0.5) × 360/cells
     * @param {number} index
     * @returns {{lat:number, lng:number}|null}
     */
  function cellLatLng(index) {
    const row = rowAt(index);
    if (!row) return null;
    const x = index - row.base;
    const lat = (row.north ? 1 : -1) * (row.fromEquator + 0.5) * rowLat;
    const half = halfCells(row);
    const lng = (x < half ? x + 0.5 : half - x - 0.5) * (360 / row.cells);
    return { lat, lng };
  }

  /** 格子序号 → 格中心单位方向向量（游戏局部坐标: 纬度 = asin(y)、经度 0° = -Z、东 = +X） */
  function cellDirection(index) {
    const ll = cellLatLng(index);
    if (!ll) return null;
    const lat = ll.lat * DEG;
    const lng = ll.lng * DEG;
    const cosLat = Math.cos(lat);
    return [cosLat * Math.sin(lng), Math.sin(lat), -cosLat * Math.cos(lng)];
  }

    /**
     * 经纬度网格坐标 → 格子序号（游戏 PlatformSystem.GetReformIndexForSegment）
     * @param {number} latSeg 纬度网格坐标（1 单位 = 360/segment 度，5 单位 = 1 行）
     * @param {number} lngSeg 经度网格坐标（1 单位 = 360/该行分段数 度，5 单位 = 1 格）
     */
  function indexOfSegments(latSeg, lngSeg) {
    // 行号: 正纬度向上取整、负纬度向下取整，保证格中心（半格）落在自己那一行
    const latCell = latSeg > 0 ? Math.ceil(latSeg * 5) : Math.floor(latSeg * 5);
    let lngCell = lngSeg > 0 ? Math.ceil(lngSeg * 5) : Math.floor(lngSeg * 5);
    const y = latCell > 0 ? latCell - 1 : latHalf - latCell - 1;
    if (y < 0 || y >= latitudeCount) return -1;

    const row = rows[y];
    const half = halfCells(row);
    // 经度格号先按「环上线性坐标」算: 越过 ±半圈就绕到另一侧
    if (lngCell > half) lngCell = lngCell - row.cells - 1;
    if (lngCell < -half) lngCell = row.cells + lngCell + 1;
    // 线性坐标 → 镜像格号（东半圈在前、西半圈在后）
    const x = lngCell > 0 ? lngCell - 1 : half - lngCell - 1;
    if (x < 0 || x >= row.cells) return -1;
    return row.base + x;
  }

  /** 经纬度（度）→ 格子序号（吸附到最近格中心，与游戏 GetReformIndexForPosition 一致）；网格外 → -1 */
  function indexOfLatLng(lat, lng) {
    const latSeg = (Number(lat) || 0) / 360 * segment;
    // 经度分段数按未吸附的纬度档取（游戏同样如此）
    const segCount = determineLongitudeSegmentCount(Math.floor(Math.abs(latSeg)), segment);
    const lngSeg = (Number(lng) || 0) / 360 * segCount;
    // 格中心在 0.1 网格单位的奇数倍上: 偶数（= 落在格子边界上）按游戏的方式往绝对值大的方向挪一格
    const snapOdd = (segs) => {
      const rounded = Math.round(segs * 10);
      let abs = Math.abs(rounded);
      if (abs % 2 !== 1) {
        abs = Math.floor(Math.abs(segs) * 10);
        if (abs % 2 !== 1) abs += 1;
      }
      return (rounded >= 0 ? abs : -abs) / 10;
    };
    const latSnap = snapOdd(latSeg);
    if (latSnap >= latLimit || latSnap <= -latLimit) return -1;
    return indexOfSegments(latSnap, snapOdd(lngSeg));
  }

    /** 经纬度（度）→ 最近的格子（含格中心与新序号；网格外 → null） */
  function snapCell(lat, lng) {
    const index = indexOfLatLng(lat, lng);
    if (index < 0) return null;
    const cell = cellOfIndex(index);
    const ll = cellLatLng(index);
    return { index, row: cell.row, x: cell.x, lat: ll.lat, lng: ll.lng };
  }

  /** 按行遍历（赤道 → 北极，再从赤道 → 南极） */
  function forEachRow(fn) {
    for (let i = 0; i < latitudeCount; i += 1) fn(rows[i]);
  }

  /** 按格子序号遍历全部格子（行优先、经度最快），格中心经纬度直接传入 */
  function forEachCell(fn) {
    for (let i = 0; i < latitudeCount; i += 1) {
      const row = rows[i];
      const sign = row.north ? 1 : -1;
      const lat = sign * (row.fromEquator + 0.5) * rowLat;
      const half = halfCells(row);
      const cellAngle = 360 / row.cells;
      for (let x = 0; x < row.cells; x += 1) {
        const lng = (x < half ? x + 0.5 : half - x - 0.5) * cellAngle;
        fn(row.base + x, row.row, x, lat, lng);
      }
    }
  }

  return {
    radius: Number(radius) > 0 ? Number(radius) : DEFAULT_PLANET_RADIUS,
    segment,
    equatorSegments,
    rowLat,
    latHalf,
    latitudeCount,
    total,
    rows,
    rowAt,
    cellOfIndex,
    cellIndexOf,
    cellLatLng,
    cellDirection,
    indexOfLatLng,
    snapCell,
    forEachRow,
    forEachCell,
  };
}
