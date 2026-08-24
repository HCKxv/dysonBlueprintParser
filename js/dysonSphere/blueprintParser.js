import { ticksTime, compareVersion } from './lib/utils.js';
import { BinaryReader, decodeBase64Gzip } from './lib/codec.js';
import { blueprintTypeName } from './lib/domain.js';

// 解析蓝图头部
function parseHeader(headerString) {
  const values = headerString.split(',');
  if (values.length !== 5 || values[0] !== '0') {
    throw new Error(`蓝图头部格式错误：${headerString}`);
  }

  const ticks = values[1].trim();
  const typeId = Number(values[3]);
  const latLimit = Number(values[4]);

  return {
    raw: headerString,
    createdTicks: ticks,
    createdAt: ticksTime(ticks),
    version: values[2].trim(),
    typeId,
    typeName: blueprintTypeName(typeId),
    latLimit,
  };
}

const BLUEPRINT_PREFIX = 'DYBP:';

// 解析完整蓝图字符串
async function parseBlueprintString(blueprintString) {
  blueprintString = blueprintString.trim();

  if (typeof blueprintString !== 'string') {
    throw new TypeError('blueprintString must be a string');
  }

  if (!blueprintString.startsWith(BLUEPRINT_PREFIX)) {
    throw new Error(`蓝图格式错误: 必须以 ${BLUEPRINT_PREFIX} 开头`);
  }

  const rawBody = blueprintString.slice(5);  // 去掉前缀 DYBP:
  const segments = rawBody.split('"');
  if (segments.length < 3) {
    throw new Error('蓝图格式错误: 未找到中段或签名');
  }

  const headerString = segments[0];
  const bodyString = segments[1];
  const signature = segments[2];

  const header = parseHeader(headerString);

  // 版本 <= 0.9.24.11286 使用旧版格式
  const isOldFormat = compareVersion(header.version, '0.9.24.11286') <= 0;
  const body = isOldFormat
    ? await parseOldBlueprintBody(bodyString, header.typeId)
    : await parseBlueprintBody(bodyString, header.typeId);

  return {
    header,
    body,
    //signature,
  };
}

// 解析蓝图主体
async function parseBlueprintBody(bodyString, typeId) {
  const decoded = await decodeBase64Gzip(bodyString);
  const reader = new BinaryReader(decoded);

  reader.readInt32();  //version?

  const body = {
    typeId,
    typeName: blueprintTypeName(typeId),
  };

  if (typeId === 3 || typeId === 4) {
    body.dysonCloud = parseDysonCloud(reader);
  }

  if (typeId === 2 || typeId === 4) {
    body.dysonShell = parseDysonShell(reader);
  }

  if (typeId === 1) {
    body.singleShell = parseSingleShell(reader);
  }

  return body;
}

// 旧版蓝图主体解析（版本 <= 0.9.24.11286）
// 与新版的主要区别：无初始 int32 占位符、轨道无版本前缀、无太阳帆颜色数据
async function parseOldBlueprintBody(bodyString, typeId) {
  const decoded = await decodeBase64Gzip(bodyString);
  const reader = new BinaryReader(decoded);

  // 旧版格式没有初始 int32(0) 占位符

  const body = {
    typeId,
    typeName: blueprintTypeName(typeId),
  };

  if (typeId === 3 || typeId === 4) {
    body.dysonCloud = parseOldDysonCloud(reader);
  }

  if (typeId === 2 || typeId === 4) {
    body.dysonShell = parseOldDysonShell(reader);
  }

  if (typeId === 1) {
    body.singleShell = parseSingleShell(reader);
  }

  return body;
}

// 解析戴森云
function parseDysonCloud(reader) {
  const visibility = parseVisibility(reader);
  const orbits = [];
  for (let i = 0; i < 20; i += 1) {
    orbits.push(parseOrbit(reader));
  }

  const colorCount = reader.readInt32();
  const colors = [];
  for (let i = 0; i < colorCount; i += 1) {
    colors.push(parseHSVColor(reader));
  }

  return {
    visibility,
    orbits,
    colors,
  };
}

// 旧版戴森云解析
function parseOldDysonCloud(reader) {
  const visibility = parseVisibility(reader);
  const orbits = [];
  for (let i = 0; i < 20; i += 1) {
    orbits.push(parseOldOrbit(reader));
  }

  // 旧版没有太阳帆颜色数据

  return {
    visibility,
    orbits,
    colors: [],
  };
}

// 解析戴森壳部分
function parseDysonShell(reader) {
  const visibility = parseVisibility(reader);
  const orbitCount = reader.readInt32();
  const orbitList = new Array(orbitCount).fill(null);
  for (let i = 0; i < orbitCount; i += 1) {
    if (reader.readBool()) {
      orbitList[i] = parseOrbit(reader);
    }
  }

  const shellCount = reader.readInt32();
  const shells = new Array(shellCount).fill(null);
  for (let i = 0; i < shellCount; i += 1) {
    if (reader.readBool()) {
      shells[i] = parseSingleShell(reader);
    }
  }

  return {
    visibility,
    orbitList,
    shells,
  };
}

// 旧版戴森壳解析
function parseOldDysonShell(reader) {
  const visibility = parseVisibility(reader);
  const orbitCount = reader.readInt32();
  const orbitList = new Array(orbitCount).fill(null);
  for (let i = 0; i < orbitCount; i += 1) {
    if (reader.readBool()) {
      orbitList[i] = parseOldOrbit(reader);
    }
  }

  const shellCount = reader.readInt32();
  const shells = new Array(shellCount).fill(null);
  for (let i = 0; i < shellCount; i += 1) {
    if (reader.readBool()) {
      shells[i] = parseSingleShell(reader);
    }
  }

  return {
    visibility,
    orbitList,
    shells,
  };
}

// 解析单层壳结构
function parseSingleShell(reader) {
  const version = reader.readInt32();
  const nodes = parseComponentList(reader, parseNode);
  const frames = parseComponentList(reader, parseFrame);
  const faces = parseComponentList(reader, parseFace);
  const fillGrid = version >= 1 ? parseFillGrid(reader) : null;

  return {
    //version,
    nodes,
    frames,
    faces,
    fillGrid,
  };
}

// 解析组件列表
function parseComponentList(reader, parseItem) {
  const capacity = reader.readInt32();
  const pointer = reader.readInt32();
  const recycleCount = reader.readInt32();
  const list = new Array(pointer).fill(null);

  for (let i = 1; i < pointer; i += 1) {
    const id = reader.readInt32();
    if (id !== 0) {
      list[i] = parseItem(reader);
    }
  }

  for (let i = 0; i < recycleCount; i += 1) {
    reader.readInt32();
  }

  return list;
}

// 解析节点数据
function parseNode(reader) {
  const version = reader.readInt32();
  const itemId = reader.readInt32();
  const style = reader.readInt32();
  reader.readBool();
  reader.readBool();
  const coordinate = parseCoordinate(reader);
  const structurePoints = reader.readInt32();

  // 原节点的建造进度
  if (version >= 2) {
    reader.readInt32();  // 游戏分配的渲染id
  }
  reader.readInt32();  // 框架建造轮询
  if (version >= 1) {
    reader.readInt32();  // 壳面建造轮询
  }
  reader.readInt32();  // 待建造的结构点
  if (version >= 4) {
    reader.readInt32();  // 待建造的细胞点
  }

  let color = null;
  if (version >= 5) {
    color = parseRGBColor(reader);
  }

  return {
    id: itemId,
    style,
    coordinate,
    structurePoints,
    color,
  };
}

// 解析框架数据
function parseFrame(reader) {
  const version = reader.readInt32();
  const itemId = reader.readInt32();
  const style = reader.readInt32();
  reader.readBool();
  const nodeA = reader.readInt32();
  const nodeB = reader.readInt32();
  const type = reader.readUInt8();

  const structurePoints = reader.readInt32();
  let color = null;
  if (version >= 1) {
    color = parseRGBColor(reader);
  }

  return {
    id: itemId,
    style,
    type,
    relation: [nodeA, nodeB],
    structurePoints,
    color,
  };
}

// 解析壳面数据
function parseFace(reader) {
  const version = reader.readInt32();
  const itemId = reader.readInt32();
  const pattern = reader.readInt32();
  reader.readInt32();  // 每顶点细胞点数

  let color = null;
  if (version >= 2) {
    color = parseRGBColor(reader);
  }

  const nodeCount = reader.readInt32();
  const relation = [];
  for (let i = 0; i < nodeCount; i += 1) {
    relation.push(reader.readInt32());
  }

  return {
    id: itemId,
    pattern,
    relation,
    color,
  };
}

// 解析涂色网格
function parseFillGrid(reader) {
  const gridType = reader.readInt32();
  const hasColors = reader.readBool();
  if (!hasColors) {
    return { gridType, colors: null };
  }

  const colorCount = reader.readInt32();
   const colors = [];
   for (let i = 0; i < colorCount; i += 1) {
     colors.push(parseRGBColor(reader));
   }

  return {
    gridType,
    colors,
  };
}

// 解析可见性掩码
function parseVisibility(reader) {
  return {
    editor: reader.readUInt32(),
    inGame: reader.readUInt32(),
  };
}

// 解析轨道数据项
function parseOrbit(reader) {
  const version = reader.readInt32();
  const id = reader.readInt32();
  const radius = reader.readFloat32();
  const x = reader.readFloat32();
  const y = reader.readFloat32();
  const z = reader.readFloat32();
  const w = reader.readFloat32();
  const hasOrbit = reader.readBool();

  if (!hasOrbit) {
    return null;
  }

  return {
    //version,
    id,
    radius,
    x,
    y,
    z,
    w,
  };
}

// 旧版轨道解析
function parseOldOrbit(reader) {
  const id = reader.readInt32();
  const radius = reader.readFloat32();
  const x = reader.readFloat32();
  const y = reader.readFloat32();
  const z = reader.readFloat32();
  const w = reader.readFloat32();
  const hasOrbit = reader.readBool();

  if (!hasOrbit) {
    return null;
  }

  return {
    id,
    radius,
    x,
    y,
    z,
    w,
  };
}

// 解析三维坐标
function parseCoordinate(reader) {
  return {
    x: reader.readFloat32(),
    y: reader.readFloat32(),
    z: reader.readFloat32(),
  };
}

// 解析 HSVA 颜色，范围为 0-1
function parseHSVColor(reader) {
  const h = reader.readFloat32();
  const s = reader.readFloat32();
  const v = reader.readFloat32();
  const a = reader.readFloat32();
  return { h, s, v, a };
}

// 解析 RGBA 颜色值
function parseRGBColor(reader) {
  const r = reader.readUInt8();
  const g = reader.readUInt8();
  const b = reader.readUInt8();
  const a = reader.readUInt8();
  return { r, g, b, a };
}

export { parseBlueprintString };

// Example usage:
// import { parseBlueprintString } from './blueprintParser.js';
// const blueprint = await parseBlueprintString('DYBP:0,637709952000000000,1,4,0"..."ABC');
// console.log(JSON.stringify(blueprint, null, 2));

/**
 * parseBlueprintString 返回值结构
 *
 * {
 *   header: {
 *     raw: string,          // 原始头部
 *     createdTicks: string, // .NET ticks
 *     createdAt: string,    // 格式化时间
 *     version: string,      // 游戏版本号
 *     typeId: number,       // 1-4
 *     typeName: string,     // 中文类型名
 *     latLimit: number,     // 纬度限制
 *   },
 *   body: {
 *     typeId, typeName,
 *     singleShell?, // typeId=1   — { nodes: (Node|null)[], frames: (Frame|null)[], faces: (Face|null)[], fillGrid: FillGrid|null }
 *     dysonShell?,  // typeId=2,4 — { visibility, orbitList: (Orbit|null)[], shells: (SingleShell|null)[] }
 *     dysonCloud?,  // typeId=3,4 — { visibility, orbits: (Orbit|null)[20], colors: HSVA[] }
 *   }
 * }
 *
 * Node   { id, style, coordinate: {x,y,z}, structurePoints, color: RGBA? }
 * Frame  { id, style, type, relation: [nodeA,nodeB], color: RGBA? }
 * Face   { id, pattern, relation: nodeId[], color: RGBA? }
 * Orbit  { id, radius, x, y, z, w }  // 四元数旋转
 * FillGrid { gridType, colors: RGBA[]? }
 *
 * Visibility = { editor: number, inGame: number }  // 掩码
 * RGBA       = { r, g, b, a }  // 0-255
 * HSVA       = { h, s, v, a }  // 0-1
 *
 * Nodes/Frames/Faces/shells 数组均为稀疏数组（下标即 id，null 为空位）
 */
