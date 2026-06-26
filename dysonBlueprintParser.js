// 蓝图类型 id 对应的中文名称
const BlueprintType = {
  names: {
    1: '单层戴森壳',
    2: '多层戴森壳',
    3: '戴森云',
    4: '戴森球(包含壳、云)',
  },
  // 根据蓝图类型 id 返回中文类型名称
  getName(typeId) {
    return this.names[typeId] ?? `未知类型(${typeId})`;
  },
};

// 二进制读取器，用于从 Uint8Array 中按小端序读取各种基础类型
class BinaryReader {
  constructor(array) {
    this.data = array instanceof Uint8Array ? array : new Uint8Array(array);
    this.view = new DataView(this.data.buffer, this.data.byteOffset, this.data.byteLength);
    this.offset = 0;
  }

  readInt32() {
    const value = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return value;
  }

  readUInt32() {
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }

  readFloat32() {
    const value = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return value;
  }

  readUInt8() {
    const value = this.view.getUint8(this.offset);
    this.offset += 1;
    return value;
  }

  readBool() {
    const value = this.readUInt8();
    return value !== 0;
  }

  skip(bytes) {
    this.offset += bytes;
  }
}

// 将 .NET ticks 转换为 JavaScript Date 对象
function ticksToDate(ticks) {
  const ticksBigInt = BigInt(ticks);
  const msSinceDotNetEpoch = ticksBigInt / 10_000n;
  const dotNetEpochToUnixMs = 62135596800000n;
  const msSinceUnixEpoch = msSinceDotNetEpoch - dotNetEpochToUnixMs;
  return new Date(Number(msSinceUnixEpoch));
}

// 将 Base64 字符串解码为 Uint8Array
function base64ToUint8Array(base64String) {
  const binary = atob(base64String);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function decodeBase64Gzip(base64String) {
  const compressed = base64ToUint8Array(base64String);

  if (typeof DecompressionStream === 'function') {
    const ds = new DecompressionStream('gzip');
    const decompressedStream = new Response(compressed).body.pipeThrough(ds);
    const arrayBuffer = await new Response(decompressedStream).arrayBuffer();
    return new Uint8Array(arrayBuffer);
  }

  if (typeof pako !== 'undefined' && typeof pako.ungzip === 'function') {
    return pako.ungzip(compressed);
  }

  throw new Error('浏览器不支持 gzip 解压，请在环境中引入 pako 或使用支持 DecompressionStream 的浏览器。');
}

function parseHeader(headerString) {
  const values = headerString.split(',');
  if (values.length !== 5 || values[0] !== '0') {
    throw new Error(`蓝图头部格式错误：${headerString}`);
  }

  const ticks = values[1].trim();
  const typeId = Number(values[3]);

  return {
    raw: headerString,
    createdTicks: BigInt(ticks),
    createdAt: ticksToDate(ticks),
    version: values[2].trim(),
    typeId,
    typeName: BlueprintType.getName(typeId),
    extra: values[4].trim(),
  };
}

// 解析完整蓝图字符串：
// 1) 拆分头部、主体和签名
// 2) 解析头部元信息
// 3) 解码并解析主体数据
async function parseBlueprintString(blueprintString) {
  if (typeof blueprintString !== 'string') {
    throw new TypeError('blueprintString must be a string');
  }

  if (!blueprintString.startsWith('DYBP:')) {
    throw new Error('蓝图格式错误: 必须以 DYBP: 开头');
  }

  const rawBody = blueprintString.slice(5);
  const segments = rawBody.split('"');
  if (segments.length < 3) {
    throw new Error('蓝图格式错误: 未找到中段或签名');
  }

  const headerString = segments[0];
  const bodyString = segments[1];
  const signature = segments[2];

  const header = parseHeader(headerString);
  const body = await parseBlueprintBody(bodyString, header.typeId);

  return {
    header,
    body,
    //signature: signature.trim(),
  };
}

// 解析蓝图主体：先解压 gzip 数据，再根据蓝图类型选择对应解析器
async function parseBlueprintBody(bodyString, typeId) {
  const decoded = await decodeBase64Gzip(bodyString);
  const reader = new BinaryReader(decoded);

  // Ignore initial int32 placeholder
  reader.readInt32();

  const body = {
    //typeId,
    typeName: BlueprintType.getName(typeId),
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

// 解析戴森云部分：可见性、20 路轨道和颜色列表
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

// 解析戴森壳部分：可见性、轨道列表和单层壳列表
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

// 解析单层壳结构：版本号、节点/框架/壳面列表，以及可选填色网格
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

// 解析组件列表结构：capacity/pointer/recycleCount，然后按 id 解码每个非空组件
function parseComponentList(reader, parseItem) {
  const capacity = reader.readInt32();
  const pointer = reader.readInt32();
  const recycleCount = reader.readInt32();
  const list = new Array(pointer).fill(null);

  for (let i = 1; i < pointer; i += 1) {
    const id = reader.readInt32();
    if (id !== 0) {
      list[i] = parseItem(reader, id);
    }
  }

  for (let i = 0; i < recycleCount; i += 1) {
    reader.readInt32();
  }

  return list;
}

// 解析节点数据项，包含版本字段、样式、坐标、结构点数以及可选颜色
function parseNode(reader, id) {
  const version = reader.readInt32();
  const itemId = reader.readInt32();
  const style = reader.readInt32();
  reader.readBool();
  reader.readBool();
  const coordinate = parseCoordinate(reader);
  const structurePoints = reader.readInt32();

  if (version >= 2) {
    reader.readInt32();
  }
  reader.readInt32();
  if (version >= 1) {
    reader.readInt32();
  }
  reader.readInt32();
  if (version >= 4) {
    reader.readInt32();
  }

  let color = null;
  if (version >= 5) {
    color = parseRGBColor(reader);
  }

  return {
    id: itemId || id,
    style,
    coordinate,
    structurePoints,
    color,
  };
}

// 解析框架数据项，包含版本字段、节点关系、类型、结构点数和可选颜色
function parseFrame(reader, id) {
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
    id: itemId || id,
    style,
    type,
    structureRelation: [nodeA, nodeB],
    //structurePoints,
    color,
  };
}

// 解析壳面数据项，包含版本字段、图案、可选颜色和节点关系列表
function parseFace(reader, id) {
  const version = reader.readInt32();
  const itemId = reader.readInt32();
  const pattern = reader.readInt32();
  reader.readInt32();

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
    id: itemId || id,
    pattern,
    relation,
    color,
  };
}

// 解析单层壳可选填色网格信息，包括网格类型和颜色列表
function parseFillGrid(reader) {
  const gridType = reader.readInt32();
  const hasColors = reader.readBool();
  if (!hasColors) {
    return { gridType, colors: null };
  }

  const colorCount = reader.readInt32();
  const colors = [];
   let n = 0;
   for (let i = 0; i < colorCount; i += 1) {
     const rgb = parseRGBColor(reader);
     if (rgb.a) n += 1;
     colors.push(rgb);
   }

  return {
    gridType,
    n,
    colors,
  };
}

// 解析可见性结构：编辑器可见性和游戏内可见性
function parseVisibility(reader) {
  return {
    editor: reader.readUInt32(),
    inGame: reader.readUInt32(),
  };
}

// 解析轨道数据项，包含版本、id、半径、四元数坐标和是否有效的标记
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

// 解析三维坐标
function parseCoordinate(reader) {
  return {
    x: reader.readFloat32(),
    y: reader.readFloat32(),
    z: reader.readFloat32(),
  };
}

// 解析 HSV 颜色，返回原始 HSVA 数据
function parseHSVColor(reader) {
  const h = reader.readFloat32();
  const s = reader.readFloat32();
  const v = reader.readFloat32();
  const a = reader.readFloat32();
  return { h, s, v, a };
}

// 解析 RGBA 颜色值（4 字节）
function parseRGBColor(reader) {
  const r = reader.readUInt8();
  const g = reader.readUInt8();
  const b = reader.readUInt8();
  const a = reader.readUInt8();
  return { r, g, b, a };
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

export { parseBlueprintString, BlueprintType};

// Example usage:
// import { parseBlueprintString } from './dysonBlueprintParser.js';
// const blueprint = await parseBlueprintString('DYBP:0,637709952000000000,1,4,0"..."ABC');
// console.log(JSON.stringify(blueprint, null, 2));
