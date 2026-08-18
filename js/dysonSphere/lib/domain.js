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

// 从掩码中获取可见性
function isVisible(visibilityMask, index) {
  return (visibilityMask >>> index) & 1;
}

const STAR_TYPE_COLORS = [
  { type: 'M', maxLum: 0.90, back: 0xB28174, core: 0xFF4032 },
  { type: 'K', maxLum: 0.98, back: 0xB29886, core: 0xFF7842 },
  { type: 'G', maxLum: 1.08, back: 0xB2A886, core: 0xFFED2A },
  { type: 'F', maxLum: 1.25, back: 0xB1B29D, core: 0xF9FF99 },
  { type: 'A', maxLum: 1.55, back: 0xAAB0B2, core: 0xFFFFFF },
  { type: 'B', maxLum: 2.00, back: 0x8198B2, core: 0x55A2FF },
  { type: 'O', maxLum: Infinity, back: 0x748BB2, core: 0x2E47FF },
];

/**
 * 按光度系数取恒星配色
 * @param {number} luminosity  光度系数
 * @returns {{type: string, back: number, core: number}}
 */
function getStarColors(luminosity) {
  return STAR_TYPE_COLORS.find(s => luminosity < s.maxLum)
    ?? STAR_TYPE_COLORS[STAR_TYPE_COLORS.length - 1];
}

export { BLUEPRINT_TYPE_NAMES, blueprintTypeName, getBodyTypeId, GRID_TYPE_NAMES, gridTypeName, countPaintedCells, isVisible, STAR_TYPE_COLORS, getStarColors };
