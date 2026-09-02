// 将 .NET ticks 转换为格式化的时间字符串
function ticksTime(ticks) {
  // 公元 1 年到 1970 年 1 月 1 日的 ticks 数
  const EPOCH_OFFSET_TICKS = 621355968000000000;
  // 1 tick = 100 纳秒，1 毫秒 = 10000 ticks
  const ms = (ticks - EPOCH_OFFSET_TICKS) / 10000;

  const date = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');

  const year = date.getUTCFullYear();
  const month = pad(date.getUTCMonth() + 1);  // 月份从 0 开始
  const day = pad(date.getUTCDate());
  const hours = pad(date.getUTCHours());
  const minutes = pad(date.getUTCMinutes());
  const seconds = pad(date.getUTCSeconds());

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

// 比较版本号：v1 > v2 返回 1，v1 < v2 返回 -1，相等返回 0
function compareVersion(v1, v2) {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);
  const maxLen = Math.max(parts1.length, parts2.length);

  for (let i = 0; i < maxLen; i++) {
    const num1 = parts1[i] || 0; // 不足的位补 0
    const num2 = parts2[i] || 0;
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }
  return 0;
}

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
  ticksTime,
  compareVersion,
  hsvaToRgba,
  quaternionToOrbitParams,
  blueprintTypeName,
  getBodyTypeId,
  gridTypeName,
  countPaintedCells,
};
