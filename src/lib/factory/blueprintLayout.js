/**
 * blueprintLayout.js — 把工厂蓝图摊到行星网格上
 *
 * 复刻游戏 BuildTool_BlueprintPaste + BlueprintUtils 的粘贴落点算法，约束:
 *   - 纬度每 5 行一档，档之间格数变化；区域不跨档（跨档选区会被拆成多个区域），
 *     格宽一律取本区域起始纬度那一档
 *   - 多区域用 parentIndex 串成链（主区域 = −1）: 子起点 = 父起点 + tropicAnchor × 父格宽
 *     − anchorLocalOffsetX × 本格宽，行偏移取 anchorLocalOffsetY
 *   - 落点由光标决定；预览里没有光标，于是单区域竖直居中放赤道，多区域找各区域 areaSegments
 *     都对得上的位置（尽量靠赤道），主区域水平居中到 0° 经线
 *
 * 口径: 格宽用蓝图那套（边界行号 → 档 = (|idx|−1)/5），与地基网格的行口径（档 = floor(行号/5)）
 * 在回归线上差一行 —— 游戏自身的差异，这里跟着蓝图走。
 */

import {
  DEFAULT_PLANET_RADIUS,
  determineLongitudeSegmentCount,
  planetGridSegment,
} from '../grid/planetGrid.js';

const TWO_PI = Math.PI * 2;
const RAD_TO_DEG = 180 / Math.PI;
const DEG = Math.PI / 180;

/** 四舍五入远离零（游戏的 _round2int） */
function roundAwayFromZero(value) {
  return value > 0 ? Math.floor(value + 0.5) : Math.ceil(value - 0.5);
}

/** 每行（格）的纬度弧度: π / (segment × 5) */
function latitudeRadPerGrid(segment) {
  return TWO_PI / (segment * 5);
}

/** 边界行号 → 该处分段数（游戏 GetLongitudeSegmentCount）: |idx| 先减 1 再除 5，边界算它南边那一档 */
function segmentCountAtBoundary(boundaryRow, segment) {
  let idx = Math.abs(boundaryRow);
  if (idx > 0) idx -= 1;
  return determineLongitudeSegmentCount(Math.trunc(idx / 5), segment);
}

/** 该边界处每格的经度弧度（游戏 GetLongitudeRadPerGrid）: π / (分段数 × 5) */
function longitudeRadPerGrid(boundaryRow, segment) {
  return TWO_PI / (segmentCountAtBoundary(boundaryRow, segment) * 5);
}

/** 这段纬度跨了几档（游戏 GetAreaCount）: >1 就是非法跨越回归线 */
function areaCountOfLatRange(latRadA, latRadB, segment) {
  const latPerGrid = latitudeRadPerGrid(segment);
  const hiRow = roundAwayFromZero(Math.max(latRadA, latRadB) / latPerGrid);
  const loRow = roundAwayFromZero(Math.min(latRadA, latRadB) / latPerGrid);
  let count = 1;
  let prev = segmentCountAtBoundary(loRow, segment);
  for (let row = loRow; row < hiRow; row += 1) {
    const next = segmentCountAtBoundary(row + 1, segment);
    if (next !== prev) count += 1;
    prev = next;
  }
  return count;
}

/** 区域尺寸（格）: size.x = 宽（经度格数）、size.y = 高（行数），至少 1 */
function areaSize(area) {
  return {
    width: Math.max(1, Math.trunc(area?.size?.x ?? 1)),
    height: Math.max(1, Math.trunc(area?.size?.y ?? 1)),
  };
}

/** 各区域起点相对主区域起点的行偏移；parentIndex 链断（数据坏了）落回 0 */
function resolveRowOffsets(areas, primaryAreaIdx) {
  const offsets = new Array(areas.length).fill(null);
  offsets[primaryAreaIdx] = 0;
  for (let pass = 0; pass < areas.length; pass += 1) {
    let changed = false;
    for (let i = 0; i < areas.length; i += 1) {
      if (offsets[i] !== null) continue;
      const parent = areas[i]?.parentIndex ?? -1;
      if (parent < 0 || parent >= areas.length || offsets[parent] === null) continue;
      offsets[i] = offsets[parent] + Math.round(areas[i]?.anchorLocalOffset?.y ?? 0);
      changed = true;
    }
    if (!changed) break;
  }
  return offsets.map((value) => value ?? 0);
}

/**
 * 网格的合法行号范围（行号 = 纬度边界索引）: 底行最低 −latHalf（=−90°）、顶行最高 +latHalf（极点）。
 * 单区域夹取用这个范围；多区域的 tropic 搜索仍按 90/latPerGrid 自己算行上限。
 */
function gridRowRange(segment) {
  const latitudeCount = Math.trunc((determineLongitudeSegmentCount(0, segment) * 5) / 2);
  const latHalf = Math.trunc(latitudeCount / 2);
  return { min: -latHalf, max: latHalf };
}

/** 每个区域都得整段落在「分段数 == 蓝图记录值」的那一档里（越出两极也算不合法） */
function fitsTropicExact(areas, rowOffsets, heights, startRow, segment) {
  const latPerGrid = latitudeRadPerGrid(segment);
  const range = gridRowRange(segment);
  for (let i = 0; i < areas.length; i += 1) {
    const loRow = startRow + rowOffsets[i];
    const hiRow = loRow + heights[i] - 1;
    if (loRow < range.min || hiRow > range.max) return false;
    if (segmentCountAtBoundary(loRow, segment) !== Math.trunc(areas[i]?.areaSegments ?? 0)) return false;
    if (areaCountOfLatRange(loRow * latPerGrid, hiRow * latPerGrid, segment) > 1) return false;
  }
  return true;
}

/** 放宽一档: 只要求相邻区域分段数的比值与蓝图记录一致（蓝图来自别的半径的行星、精确值对不上时兜底） */
function fitsTropicRatio(areas, rowOffsets, heights, startRow, segment) {
  const latPerGrid = latitudeRadPerGrid(segment);
  const range = gridRowRange(segment);
  for (let i = 0; i < areas.length; i += 1) {
    const loRow = startRow + rowOffsets[i];
    const hiRow = loRow + heights[i] - 1;
    if (loRow < range.min || hiRow > range.max) return false;
    if (areaCountOfLatRange(loRow * latPerGrid, hiRow * latPerGrid, segment) > 1) return false;
  }
  for (let i = 0; i < areas.length; i += 1) {
    const parent = areas[i]?.parentIndex ?? -1;
    if (parent < 0 || parent >= areas.length) continue;
    const recorded = (Math.trunc(areas[parent]?.areaSegments ?? 1) || 1)
      / (Math.trunc(areas[i]?.areaSegments ?? 1) || 1);
    const actual = segmentCountAtBoundary(startRow + rowOffsets[parent], segment)
      / segmentCountAtBoundary(startRow + rowOffsets[i], segment);
    if (Math.abs(recorded - actual) > 1e-4) return false;
  }
  return true;
}

/**
 * 多区域蓝图: 找一个「合适的位置」
 *
 * 合法性判据与游戏一致: 各区域不跨回归线，且相邻区域分段数之比等于记录之比（粘贴到别的纬度时
 * 整块蓝图跟着缩放，允许）。位置好坏按优先级排（前一条相同才看后一条）:
 *   给了目标: 1. 中心落在目标半球  2. 中心离目标最近  3. 分段数精确  4. 离赤道近
 *   自动:     1. 整块落在北半球    2. 中心在北半球    3. 离赤道近      4. 分段数精确
 * 「精确」只是同距离时的加分项，不是硬前置；换半球不能靠南北镜像，得走 yaw180 那一档。
 *
 * @param {{row:number, north:boolean}|null} target 目标纬度（行 + 半球）
 * @returns {{startRow:number, exact:boolean}|null}
 */
function findTropicPlacement(areas, rowOffsets, heights, segment, target = null) {
  const stackLo = Math.min(...rowOffsets);
  const stackHi = Math.max(...rowOffsets.map((offset, i) => offset + heights[i]));
  const stackCenter = (stackLo + stackHi) / 2;
  const rowLimit = Math.trunc(90 / (latitudeRadPerGrid(segment) * RAD_TO_DEG)) + 1;

  const better = (a, b) => {
    if (b === null) return true;
    if (target !== null) {
      if (a.inTargetHalf !== b.inTargetHalf) return a.inTargetHalf;
      if (Math.abs(a.toTarget - b.toTarget) > 1e-9) return a.toTarget < b.toTarget;
      if (a.exact !== b.exact) return a.exact;
      return a.distance < b.distance - 1e-9;
    }
    if (a.fullyNorth !== b.fullyNorth) return a.fullyNorth;
    if (a.northCenter !== b.northCenter) return a.northCenter;
    if (Math.abs(a.distance - b.distance) > 1e-9) return a.distance < b.distance - 1e-9;
    return a.exact && !b.exact;
  };

  let best = null;
  for (let startRow = -rowLimit; startRow <= rowLimit; startRow += 1) {
    if (!fitsTropicRatio(areas, rowOffsets, heights, startRow, segment)) continue;
    const exact = fitsTropicExact(areas, rowOffsets, heights, startRow, segment);
    const centerRow = startRow + stackCenter;
    const candidate = {
      startRow,
      exact,
      fullyNorth: startRow + stackLo >= 0,
      northCenter: centerRow >= 0,
      distance: Math.abs(centerRow),
      toTarget: target === null ? 0 : Math.abs(centerRow - target.row),
      inTargetHalf: target === null ? true : (target.north ? centerRow >= 0 : centerRow <= 0),
    };
    if (better(candidate, best)) best = candidate;
  }
  return best ? { startRow: best.startRow, exact: best.exact } : null;
}

/** 该经度是否落在这一档的格线上（游戏 SnapLongitude 用的容差 0.02 格） */
function isOnGridLine(lngRad, cellRad) {
  const cells = lngRad / cellRad;
  return Math.abs(Math.round(cells) - cells) <= 0.02;
}

/** 各区域格宽的公共细分步长（度）: 格宽 = 72 / 分段数，故取 72 / 各分段数的最小公倍数 */
function commonGridStepDeg(segmentCounts) {
  const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
  const lcm = (a, b) => (a / gcd(a, b)) * b;
  let value = 1;
  for (const count of segmentCounts) {
    if (Number.isFinite(count) && count > 0) value = lcm(value, Math.trunc(count));
  }
  return 72 / value;
}

/**
 * 把整张蓝图沿经度滑动，直到每个区域起点都落在自己那一档的格线上（游戏 SnapLongitude）:
 * 各区域格宽不同，不对齐的话建筑按整数格铺开会整体偏半格。
 *
 * @param {number} stepRad 搜索步长（弧度）
 * @returns {number|null} 需要加的经度偏移；搜不到共同解返回 null（调用方退化为逐区域贴格线）
 */
function alignAreasToGrid(startLngs, areaLngPerGrid, stepRad) {
  if (!(stepRad > 0)) return null;
  for (let i = 0; i < 600; i += 1) {
    const offset = ((i % 2 === 1) ? -(Math.floor(i / 2) + 1) : Math.floor(i / 2)) * stepRad;
    let ok = true;
    for (let j = 0; j < startLngs.length; j += 1) {
      if (isOnGridLine(startLngs[j] + offset, areaLngPerGrid[j])) continue;
      ok = false;
      break;
    }
    if (ok) return offset;
  }
  return null;
}

/** 两份落点哪个更该用: 有目标就比「落在目标半球 → 离目标多近」，否则北半球优先、其次中心纬度低 */
function preferLayout(candidate, current, target = null) {
  const rangeOf = (layout) => {
    const rows = layout.areas.map((area) => area.rowLo);
    const rowHi = layout.areas.map((area) => area.rowHi + 1);
    const lo = Math.min(...rows);
    const hi = Math.max(...rowHi);
    return { lo, hi, center: (lo + hi) / 2 };
  };
  const a = rangeOf(candidate);
  const b = rangeOf(current);
  const exactOf = (layout) => layout.placement?.exact !== false;
  if (target !== null) {
    const aHalf = target.north ? a.center >= 0 : a.center <= 0;
    const bHalf = target.north ? b.center >= 0 : b.center <= 0;
    if (aHalf !== bHalf) return aHalf;
    const da = Math.abs(a.center - target.row);
    const db = Math.abs(b.center - target.row);
    if (Math.abs(da - db) > 1e-9) return da < db;
    if (exactOf(candidate) !== exactOf(current)) return exactOf(candidate);
    return Math.abs(a.center) < Math.abs(b.center) - 1e-9;
  }
  if ((a.lo >= 0) !== (b.lo >= 0)) return a.lo >= 0;
  if ((a.center >= 0) !== (b.center >= 0)) return a.center >= 0;
  if (Math.abs(Math.abs(a.center) - Math.abs(b.center)) > 1e-9) {
    return Math.abs(a.center) < Math.abs(b.center);
  }
  return exactOf(candidate) && !exactOf(current);
}

/**
 * 把一份工厂蓝图摊到行星网格上
 *
 * @param {object} blueprint factoryParser 的解析结果
 * @param {object} [options]
 * @param {number|null} [options.targetLatDeg] 目标纬度（度）: 优先吸附到离它最近的位置。
 *   null / 不传 = 自动（北半球优先、其次低纬度）。
 * @param {boolean} [options.targetNorth] 目标半球（true = 北，false = 南），默认按 targetLatDeg 的正负。
 *   单独给是为了「北 0°」和「南 0°」能区分开 —— 纬度 0 时正负号表达不了半球。
 *   单区域蓝图只用纬度（区域中心摆在目标纬线上）。
 * @param {number} [options.radius] 行星半径（默认 200，游戏里可铺地基的行星都是这个）
 * @returns {{areas: Array<object>, buildings: Array<object|null>, placement: object|null, focus: object}}
 *
 * 多区域蓝图会算两遍 —— 原样和旋转 180° —— 再按同一套偏好挑一份（游戏里也是自动在 0°/180° 之间切）。
 *
 * buildings 是**稀疏数组**: 下标就是建筑序号（building.index），落不了位的留 null，
 */
export function layoutBlueprint(blueprint, options = {}) {
  const targetLatDeg = Number.isFinite(options?.targetLatDeg) ? options.targetLatDeg : null;
  const segment = planetGridSegment(options?.radius ?? DEFAULT_PLANET_RADIUS);
  const target = targetLatDeg === null ? null : {
    row: targetLatDeg / (latitudeRadPerGrid(segment) * RAD_TO_DEG),
    north: typeof options?.targetNorth === 'boolean' ? options.targetNorth : targetLatDeg >= 0,
  };
  // 两种朝向各解一次（找位置只依赖区域数据）；建筑只按赢的那个朝向生成一遍
  const areas = Array.isArray(blueprint?.areas) ? blueprint.areas : [];
  const original = solvePlacement(blueprint, { ...options, yaw180: false });
  const rotated = areas.length < 2 ? null : solvePlacement(blueprint, { ...options, yaw180: true });
  const useRotated = rotated !== null && preferLayout(rotated, original, target);
  const chosen = useRotated ? rotated : original;
  if (chosen.placement) chosen.placement.rotated = useRotated;
  const { buildings, focus } = emitBuildings(blueprint, chosen);
  return { areas: chosen.areas, buildings, placement: chosen.placement, focus };
}

/**
 * 找位置。返回 { placement, areas, ctx }（ctx 是 emitBuildings 生成建筑所需的量）。
 *
 * yaw180 = true: 蓝图数据已被 rotate180 转过，RefreshBuildPreview 的 num2/num3 同时取 −1。
 * 格宽口径: 父档格宽按父区域位移后的纬度算、子档按子区域位移前的纬度算，否则各区域相对经度差
 * 零点几格、整体对齐搜不到解。这不是镜像（手性保持），建筑在本区域盒内做点反射 x' = w−1−x, y' = h−1−y。
 *
 * @param {object} blueprint factoryParser 的解析结果
 * @param {{radius?:number, targetLatDeg?:number|null, targetNorth?:boolean, yaw180?:boolean}} options
 */
function solvePlacement(blueprint, options = {}) {
  const segment = planetGridSegment(options.radius ?? DEFAULT_PLANET_RADIUS);
  const latPerGridDeg = latitudeRadPerGrid(segment) * RAD_TO_DEG;
  const yaw180 = !!options?.yaw180;              // 数据已按 yaw 180 转过
  const targetLatDeg = Number.isFinite(options?.targetLatDeg) ? options.targetLatDeg : null;
  const target = targetLatDeg === null ? null : {
    row: targetLatDeg / latPerGridDeg,
    north: typeof options?.targetNorth === 'boolean' ? options.targetNorth : targetLatDeg >= 0,
  };
  const targetRow = target === null ? null : target.row;

  const areas = Array.isArray(blueprint?.areas) ? blueprint.areas : [];
  const buildings = Array.isArray(blueprint?.buildings) ? blueprint.buildings : [];
  // 没有区域: 返回空结果（ctx 必须有，emitBuildings 会解构它）
  if (!areas.length) {
    return {
      placement: null,
      areas: [],
      ctx: {
        buildings: [],
        num2: 1,
        num3: 1,
        rotationStepDeg: 0,
        latPerGridDeg,
        anchorRows: [],
        anchorCells: [],
        anchorLngs: [],
        primaryAreaIdx: 0,
      },
    };
  }

  const primaryAreaIdx = Math.min(Math.max(blueprint?.primaryAreaIdx ?? 0, 0), areas.length - 1);
  const sizes = areas.map(areaSize);
  const heights = sizes.map((size) => size.height);
  const rowOffsets = resolveRowOffsets(areas, primaryAreaIdx);
  const num2 = yaw180 ? -1 : 1;
  const num3 = yaw180 ? -1 : 1;
  // 游戏里 num = floor(_yaw / 89.9)，建筑朝向要减掉 num×90（粘贴时 rotation 档位的影响）
  const rotationStepDeg = yaw180 ? 180 : 0;
  // 落点搜索用区域盒的行偏移（看盒子跨没跨回归线 / 极点），自由变量是主区域的锚点行
  const boxRowOffsets = rowOffsets.map((off, i) => num3 * off - (yaw180 ? heights[i] - 1 : 0));

  // ── 主区域锚点落在哪一行 ──
  const rowRange = gridRowRange(segment);
  /** 把盒底行夹进网格范围（盒太高放不下时优先保住南边；只在箱体比整颗行星还高时才走到） */
  const clampStartRow = (start, height) => Math.max(
    Math.min(start, rowRange.max - height + 1),
    rowRange.min,
  );
  let startRow;
  let placement;
  if (areas.length === 1) {
    // 单区域: 盒子竖直居中到目标纬线，但同样不能跨回归线（跨档后格宽不一致，游戏里这种粘贴非法）；
    // 在网格范围内、整盒落在一档里的起点行中，挑离目标最近的一个。
    const halfRow = Math.floor(heights[0] / 2);
    const centerRow = targetRow === null ? 0 : Math.round(targetRow);
    const wanted = centerRow - halfRow;
    const latPerGridRad = latPerGridDeg * DEG;
    const candidates = [];
    for (let start = rowRange.min; start + heights[0] - 1 <= rowRange.max; start += 1) {
      candidates.push({
        start,
        cross: areaCountOfLatRange(
          start * latPerGridRad,
          (start + heights[0] - 1) * latPerGridRad,
          segment,
        ),
        distance: Math.abs(start - wanted),
      });
    }
    // 先要不跨档的；区域比一档还高（只在极区可能出现）才退而求其次取跨越最少的
    const usable = candidates.filter((c) => c.cross === 1);
    const pool = usable.length ? usable : candidates;
    pool.sort((a, b) => (a.cross - b.cross) || (a.distance - b.distance) || (a.start - b.start));
    startRow = pool.length ? pool[0].start : clampStartRow(wanted, heights[0]);
    placement = {
      kind: targetRow === null ? 'equator' : 'target',
      startRow,
      exact: usable.length > 0,
    };
  } else {
    const found = findTropicPlacement(areas, boxRowOffsets, heights, segment, target);
    if (found) {
      startRow = found.startRow;
      placement = { kind: 'tropic', startRow, exact: found.exact };
    } else {
      // 记录的分段数在这颗行星上根本对不上: 整体居中到（目标纬度或赤道），至少能看
      const stackLo = Math.min(...boxRowOffsets);
      const stackHi = Math.max(...boxRowOffsets.map((offset, i) => offset + heights[i]));
      // 兜底落点也要留在网格范围内: 先按整体居中算，再把最靠北的区域拉回来
      const wanted = Math.round(targetRow ?? 0) - Math.round((stackLo + stackHi) / 2);
      startRow = Math.max(wanted, rowRange.min - stackLo, rowRange.max + 1 - stackHi);
      placement = { kind: 'fallback', startRow, exact: false };
    }
  }

  // ── 各区域的锚点与盒起点（对齐游戏 RefreshBuildPreview） ──
  // yaw 0: 锚点就是盒起点。yaw 180: 子锚点行 = 父锚点行 + num3 × anchorLocalOffsetY，经度 = 父经度
  //   + num2 × (tropicAnchor × 父锚点档格宽 − anchorLocalOffsetX × 本锚点档格宽)，盒起点 = 锚点 − (尺寸−1)
  const anchorRows = rowOffsets.map((offset) => startRow + num3 * offset);
  const anchorCells = anchorRows.map((row) => longitudeRadPerGrid(row, segment));
  const anchorLngs = new Array(areas.length).fill(0);
  const boxShiftRow = areas.map((area, i) => (yaw180 ? heights[i] - 1 : 0));
  const boxShiftLng = areas.map((area, i) => (yaw180 ? (sizes[i].width - 1) * anchorCells[i] : 0));
  const boxRows = anchorRows.map((row, i) => row - boxShiftRow[i]);

  // 主区域水平居中到 0° 经线（预览的选择，游戏里是光标决定）
  const primaryCentered = -(sizes[primaryAreaIdx].width * anchorCells[primaryAreaIdx]) / 2;
  anchorLngs[primaryAreaIdx] = Math.round(primaryCentered / anchorCells[primaryAreaIdx]) * anchorCells[primaryAreaIdx];
  const lngReady = new Array(areas.length).fill(false);
  lngReady[primaryAreaIdx] = true;
  for (let pass = 0; pass < areas.length; pass += 1) {
    let changed = false;
    for (let i = 0; i < areas.length; i += 1) {
      if (lngReady[i]) continue;
      const parent = areas[i]?.parentIndex ?? -1;
      if (parent < 0 || parent >= areas.length || !lngReady[parent]) continue;
      anchorLngs[i] = anchorLngs[parent]
        + num2 * (Math.trunc(areas[i]?.tropicAnchor ?? 0) * anchorCells[parent]
          - Math.trunc(areas[i]?.anchorLocalOffset?.x ?? 0) * anchorCells[i]);
      lngReady[i] = true;
      changed = true;
    }
    if (!changed) break;
  }

  // 整体沿经度对齐: 每个区域的盒起点都落在自己那一档的格线上（游戏 SnapLongitude）
  const boxLngs = anchorLngs.map((lng, i) => lng - boxShiftLng[i]);
  const boxCells = boxRows.map((row) => longitudeRadPerGrid(row, segment));
  const alignStepRad = commonGridStepDeg(
    boxRows.map((row) => segmentCountAtBoundary(row, segment)),
  ) * DEG;
  const alignOffset = alignAreasToGrid(boxLngs, boxCells, alignStepRad);
  if (alignOffset === null) {
    // 数据本身对不齐（只会出现在兜底落点里）: 让每个区域各自贴到最近的格线上
    for (let i = 0; i < anchorLngs.length; i += 1) {
      anchorLngs[i] = Math.round(boxLngs[i] / boxCells[i]) * boxCells[i] + boxShiftLng[i];
    }
  } else if (alignOffset !== 0) {
    for (let i = 0; i < anchorLngs.length; i += 1) anchorLngs[i] += alignOffset;
  }

  const outAreas = areas.map((area, i) => ({
    index: i,
    startLatDeg: boxRows[i] * latPerGridDeg,
    startLngDeg: (anchorLngs[i] - boxShiftLng[i]) * RAD_TO_DEG,
    /** 区域锚点 = 建筑参考点（游戏 RefreshBuildPreview 的 reference3）: yaw 0 是盒起点，yaw 180 在盒另一端 */
    anchorLatDeg: anchorRows[i] * latPerGridDeg,
    anchorLngDeg: anchorLngs[i] * RAD_TO_DEG,
    width: sizes[i].width,
    height: sizes[i].height,
    segmentCount: segmentCountAtBoundary(boxRows[i], segment),
    recordedSegments: Math.trunc(area?.areaSegments ?? 0),
    rowLo: boxRows[i],
    rowHi: boxRows[i] + sizes[i].height - 1,
  }));

  return {
    placement,
    areas: outAreas,
    ctx: {
      buildings, num2, num3, rotationStepDeg, latPerGridDeg, anchorRows, anchorCells, anchorLngs, primaryAreaIdx,
    },
  };
}

/** 用解出来的落点生成每栋建筑的经纬度、朝向与参数 */
function emitBuildings(blueprint, solved) {
  const { areas, ctx } = solved;
  const {
    buildings, num2, num3, rotationStepDeg, latPerGridDeg, anchorRows, anchorCells, anchorLngs, primaryAreaIdx,
  } = ctx;

  /** 下标 = 建筑序号 */
  const outBuildings = new Array(buildings.length).fill(null);
  for (let i = 0; i < buildings.length; i += 1) {
    const building = buildings[i];
    if (Number(building?.index) !== i) continue;   // 序号不等于自己的位置 = 数据坏，整条丢弃
    const offset = building?.localOffset?.[0];
    if (!offset) continue;
    const areaIndex = Math.min(Math.max(building?.areaIndex ?? 0, 0), areas.length - 1);
    // 游戏 BuildTool_BlueprintPaste: 以区域锚点为参考、偏移乘 num2/num3、格宽取锚点纬度那一档。
    // 这里不做任何吸附 —— 蓝图的坐标要原样还原。
    const latDeg = (anchorRows[areaIndex] + num3 * offset.y) * latPerGridDeg;
    /** 第二个端点（蓝图里第二个 localOffset）: 分拣器爪臂伸到的那一格，其余建筑与第一个端点相同 */
    const offset2 = building?.localOffset?.[1] ?? offset;
    const endLatDeg = Math.min(90, Math.max(-90, (anchorRows[areaIndex] + num3 * offset2.y) * latPerGridDeg));
    outBuildings[building.index] = {
      itemId: building.itemId,
      areaIndex,
      /** 蓝图里记的建筑序号；连接字段（conn）用的就是这套序号，传送带连线靠它对上两端 */
      index: building.index,
      /** 连接关系，-1 = 该侧无连接。 */
      conn: {
        out: building.outputObjIdx,
        in: building.inputObjIdx,
      },
      /** 建筑模型id */
      modelIndex: building.modelIndex,
      /** 配方 id（制造类建筑用；图标解析要看它） */
      recipeId: building.recipeId ?? 0,
      /** 过滤物品 id（分拣器的物品筛选；） */
      filterId: building.filterId ?? 0,
      /** 解码后的建筑参数（传送带的「图标标签槽」= parameters.iconId） */
      parameters: building.parameters ?? null,
      // 防御性夹取: 区域高度是四舍五入出来的，理论上 |纬度| 可能略大于 90
      latDeg: Math.min(90, Math.max(-90, latDeg)),
      lngDeg: (anchorLngs[areaIndex] + num2 * offset.x * anchorCells[areaIndex]) * RAD_TO_DEG,
      /**
       * 朝向（度）= building.yaw − num × 90（游戏 Maths.SphericalRotation，未旋转粘贴时 num = 0）；
       * 模型 +Y = 法线、+Z = 正北切线，再绕局部 +Y 转这个角。
       */
      yawDeg: Number(building?.yaw?.[0] ?? 0) - rotationStepDeg,
      /** 第二组朝向与俯仰 / 倾角（度）: 分拣器爪臂末端用第二组角度（yaw2/pitch2/tilt2）配第二个端点，其余建筑恒为 0 */
      yaw2Deg: Number(building?.yaw?.[1] ?? building?.yaw?.[0] ?? 0) - rotationStepDeg,
      pitchDeg: Number(building?.pitch ?? 0),
      pitch2Deg: Number(building?.pitch2 ?? 0),
      tiltDeg: Number(building?.tilt ?? 0),
      tilt2Deg: Number(building?.tilt2 ?? 0),
      /** 第二个端点的经纬度与高度（分拣器的爪臂末端）；其余建筑与第一个端点相同 */
      endLatDeg,
      endLngDeg: (anchorLngs[areaIndex] + num2 * offset2.x * anchorCells[areaIndex]) * RAD_TO_DEG,
      endAltitudeSteps: Number.isFinite(offset2.z) ? offset2.z : 0,
      /**
       * 离地高度，单位是蓝图里的「高度格」（游戏 PlanetGrid.kAltGrid = 4/3 游戏单位）:
       * 游戏复制时编码成 (建筑到球心距离 − 行星真实半径 − 0.2) / 1.3333333，粘贴反过来。
       */
      altitudeSteps: Number.isFinite(offset.z) ? offset.z : 0,
    };
  }

  return {
    buildings: outBuildings,
    focus: computeFocus(outBuildings, areas, primaryAreaIdx, latPerGridDeg),
  };
}

/**
 * 蓝图中心与角半径（度）: 有建筑就按建筑的经纬度范围取，没建筑才退回按区域范围（1 格宽的区域
 * 在极地那档有 18° 宽，用它当范围会把中心带偏）。经度范围超过半圈时没法定中心，退回主区域起点经度。
 */
function computeFocus(buildings, areas, primaryAreaIdx, latPerGridDeg) {
  const primary = areas[primaryAreaIdx] ?? areas[0];
  let latLo = Infinity;
  let latHi = -Infinity;
  let lngLo = Infinity;
  let lngHi = -Infinity;

  if (buildings.length) {
    for (const building of buildings) {
      if (!building) continue;              // 占位空洞（见 emitBuildings）
      latLo = Math.min(latLo, building.latDeg);
      latHi = Math.max(latHi, building.latDeg);
      lngLo = Math.min(lngLo, building.lngDeg);
      lngHi = Math.max(lngHi, building.lngDeg);
    }
  } else {
    for (const area of areas) {
      const cellDeg = 360 / (area.segmentCount * 5);
      if (area.width * cellDeg >= 360 - 1e-6) continue;    // 整圈，跳过
      latLo = Math.min(latLo, area.startLatDeg);
      latHi = Math.max(latHi, area.startLatDeg + area.height * latPerGridDeg);
      lngLo = Math.min(lngLo, area.startLngDeg);
      lngHi = Math.max(lngHi, area.startLngDeg + area.width * cellDeg);
    }
  }

  const usePrimaryLng = !Number.isFinite(lngLo) || lngHi - lngLo > 180;
  const latRadiusDeg = Number.isFinite(latLo) ? (latHi - latLo) / 2 : 10;
  const lngRadiusDeg = usePrimaryLng ? 0 : (lngHi - lngLo) / 2;
  return {
    latDeg: Number.isFinite(latLo) ? Math.min(90, Math.max(-90, (latLo + latHi) / 2)) : (primary?.startLatDeg ?? 0),
    lngDeg: usePrimaryLng ? (primary?.startLngDeg ?? 0) : (lngLo + lngHi) / 2,
    // 下限 2°: 太小的蓝图不至于把相机怼到地面上
    radiusDeg: Math.max(latRadiusDeg, lngRadiusDeg, 2),
    // 分开给: 斜着看时纬向会被压缩，取景要按投影后的有效半径算
    latRadiusDeg,
    lngRadiusDeg,
  };
}
