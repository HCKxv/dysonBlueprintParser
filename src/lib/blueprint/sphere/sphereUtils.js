// 将 HSVA 颜色转换为 0-255 范围的 RGBA 对象
function hsvaToRgba(h, s, v, a = 1.0) {
  if (s === 0) {
    const gray = Math.round(v * 255);
    return { r: gray, g: gray, b: gray, a: Math.round(a * 255) };
  }

  const hh = (h % 1) * 6;
  const i = Math.floor(hh);
  const ff = hh - i;
  const p = v * (1 - s);
  const q = v * (1 - s * ff);
  const t = v * (1 - s * (1 - ff));
  let r = 0;
  let g = 0;
  let b = 0;

  switch (i) {
    case 0:
      r = v;
      g = t;
      b = p;
      break;
    case 1:
      r = q;
      g = v;
      b = p;
      break;
    case 2:
      r = p;
      g = v;
      b = t;
      break;
    case 3:
      r = p;
      g = q;
      b = v;
      break;
    case 4:
      r = t;
      g = p;
      b = v;
      break;
    case 5:
      r = v;
      g = p;
      b = q;
      break;
    default:
      r = v;
      g = p;
      b = q;
      break;
  }

  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255),
    a: Math.round(a * 255),
  };
}

// 将轨道的四元数转换为倾角和升交点经度
function quaternionToOrbitParams(orbit) {
  const x = orbit.x, y = orbit.y, z = orbit.z, w = orbit.w;
  const halfInclSin = Math.hypot(x, z);
  const halfInclCos = Math.hypot(y, w);
  const rad2deg = 180 / Math.PI;
  const inclination = 2.0 * Math.atan2(halfInclSin, halfInclCos) * rad2deg;
  const longAscNode = 2.0 * Math.atan2(-y, w) * rad2deg;
  return {
    inclination: ((inclination % 360) + 360) % 360,
    ascendingNode: ((longAscNode % 360) + 360) % 360,
  };
}

// 将轨道倾角和升交点经度转换为轨道四元数
function orbitParamsToQuaternion(inclination, ascendingNode) {
  const deg2rad = Math.PI / 180;
  const hInc = (((inclination % 360) + 360) % 360) * deg2rad / 2;
  const hLan = (((ascendingNode % 360) + 360) % 360) * deg2rad / 2;
  const sz = Math.sin(-hInc), cz = Math.cos(-hInc);
  const sy = Math.sin(-hLan), cy = Math.cos(-hLan);
  return {
    x: sy * sz,
    y: sy * cz,
    z: cy * sz,
    w: cy * cz,
  };
}


const BLUEPRINT_TYPE_NAMES = {
  1: '单层戴森壳',
  2: '多层戴森壳',
  3: '戴森云',
  4: '戴森球(包含壳、云)',
};

// 根据蓝图类型 id 返回中文类型名称
function blueprintTypeName(typeId) {
  return BLUEPRINT_TYPE_NAMES[typeId] ?? `未知类型(${typeId})`;
}

/**
 * 识别蓝图 body 的类型 id（1-4）
 * @param {object} body - parsed.body 或任意疑似 body 的对象
 * @returns {number|null}
 *   1=单层壳  2=多层壳  3=戴森云  4=壳+云
 *   -1 = 结构非法
 *   null = 无法识别
 */
function getBodyTypeId(body) {
  if (!body || typeof body !== 'object') return null;
  const { singleShell, dysonShell, dysonCloud } = body;
  // 单层壳与壳/云互斥，同时出现视为非法数据
  if (singleShell && (dysonShell || dysonCloud)) return -1;
  if (singleShell) return 1;
  if (dysonShell && dysonCloud) return 4;
  if (dysonShell) return 2;
  if (dysonCloud) return 3;
  return null;
}

const GRID_TYPE_NAMES = {
  0: '经纬线网格',
  1: '二十面体网格',
  2: '八面体网格',
  3: '四面体网格',
};

function gridTypeName(gridType) {
  return GRID_TYPE_NAMES[gridType] ?? `未知(${gridType})`;
}

// 统计已涂色格子数
function countPaintedCells(colors) {
  if (!colors) return 0;
  let n = 0;
  for (let i = 0; i < colors.length; i += 1) {
    const c = colors[i];
    if (c && c.a > 0) n += 1;
  }
  return n;
}

export {
  hsvaToRgba,
  quaternionToOrbitParams,
  orbitParamsToQuaternion,
  blueprintTypeName,
  getBodyTypeId,
  gridTypeName,
  countPaintedCells,
};
