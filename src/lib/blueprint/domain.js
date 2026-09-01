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

export { BLUEPRINT_TYPE_NAMES, blueprintTypeName, getBodyTypeId, GRID_TYPE_NAMES, gridTypeName, countPaintedCells };
