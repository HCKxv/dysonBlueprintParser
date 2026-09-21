import { ticksTime } from '../utils.js';
import { BinaryReader, decodeBase64Gzip } from '../codec.js';
import { computeSignature, getSignatureParts } from '../checksum.js';
import { itemName, isBeltRange, isSorterRange } from './factoryItems.js';
import { getParamCodec } from './factoryParams.js';

// 工厂蓝图字符串固定前缀
const BLUEPRINT_PREFIX = 'BLUEPRINT:';

// 保留 4 位小数，避免浮点误差扩散
function fix(num) {
  return Number.isFinite(num) ? +num.toFixed(4) : 0;
}

// 读取三维坐标
function readXYZ(reader) {
  return {
    x: fix(reader.readFloat32()),
    y: fix(reader.readFloat32()),
    z: fix(reader.readFloat32()),
  };
}

// 安全解码 URI 组件（头部简介字段）
function decodeCell(cell) {
  if (cell === undefined) return '';
  try {
    return decodeURIComponent(cell);
  } catch {
    return cell;
  }
}

// 解析蓝图头部
// 新版（flag0=1，0.10.32.25699+）：1,layout,icons(5),0,ticks,version,shortDesc,author,customVersion,externalFields,desc（15 字段）
// 旧版（flag0=0）：0,layout,icons(5),0,ticks,version,shortDesc,desc（12 字段）
// 更早期：0,layout,icons(2),version（5 字段）
function parseHeader(headerString) {
  const cells = headerString.split(',');
  if (cells.length < 5) {
    throw new Error(`蓝图头部字段过少：${headerString}`);
  }

  // 首个字段：0 = 旧版头部，1 = 新版头部（含作者/版本/额外属性）
  const flag0 = Number(cells[0]);
  if (flag0 !== 0 && flag0 !== 1) {
    throw new Error(`蓝图头部首个字段非法：${cells[0]}`);
  }

  const layout = Number(cells[1]);
  if (!Number.isInteger(layout)) {
    throw new Error(`蓝图头部图标布局非法：${cells[1]}`);
  }

  // 定位游戏版本号（形如 0.10.28.21150）
  const versionIdx = cells.findIndex((c, i) => i >= 2 && /^\d+(\.\d+){2,3}$/.test(c));
  if (versionIdx < 0) {
    throw new Error(`蓝图头部缺少游戏版本号：${headerString}`);
  }
  const gameVersion = cells[versionIdx];

  let icons;
  let createdTicks = null;
  let shortDesc = '';
  let desc = '';
  let author = '';
  let customVersion = '';
  let externalFields = '';

  if (cells.length >= 15 && flag0 === 1) {
    // 新版头部：字段位置固定
    icons = cells.slice(2, 7).map((s) => Number(s) || 0);
    createdTicks = cells[8];
    shortDesc = decodeCell(cells[10]);
    author = decodeCell(cells[11]);
    customVersion = decodeCell(cells[12]);
    externalFields = decodeCell(cells[13]);
    desc = decodeCell(cells[14]);
  } else if (cells.length >= 12 && flag0 === 0 && /^\d+$/.test(cells[8])) {
    // 旧版头部（12 字段）
    icons = cells.slice(2, 7).map((s) => Number(s) || 0);
    createdTicks = cells[8];
    shortDesc = decodeCell(cells[10]);
    desc = decodeCell(cells[11]);
  } else {
    // 早期格式：图标为版本号前的小整数，时间戳为大数
    icons = [];
    for (let i = 2; i < versionIdx; i += 1) {
      const v = Number(cells[i]);
      if (!Number.isFinite(v) || !Number.isInteger(v)) continue;
      if (Math.abs(v) >= 1e11) {
        createdTicks = cells[i]; // 时间戳（.NET ticks）
        continue;
      }
      icons.push(v);
    }
    // 有时间戳的格式中，图标数组后固定跟一个占位 0
    if (createdTicks !== null && icons.length > 2 && icons[icons.length - 1] === 0) {
      icons.pop();
    }
    if (icons.length === 0) icons = [0, 0];
  }

  return {
    layout,
    icons,
    createdTicks,
    createdAt: createdTicks !== null ? ticksTime(createdTicks) : null,
    gameVersion,
    shortDesc,
    author,
    customVersion,
    externalFields,
    desc,
  };
}

// 读取建筑备注（int32 长度 + 7-bit 编码长度前缀 + UTF-8）
function readContent(reader) {
  const length = reader.readInt32();
  if (length > 0) {
    return reader.readString();
  }
  return null;
}

// 解析建筑数据项
function parseBuilding(reader) {
  const num = reader.readInt32();
  let b;

  if (num <= -102) {
    // 最新格式（V0.10.34.28281 / 2026-01-22 后）：前缀 -102，新增建筑备注字段
    b = {
      index: reader.readInt32(),
      itemId: reader.readInt16(),
      modelIndex: reader.readInt16(),
      areaIndex: reader.readInt8(),
      localOffset: [readXYZ(reader)],
      yaw: [fix(reader.readFloat32())],
    };
    if (isBeltRange(b.itemId)) {
      b.tilt = fix(reader.readFloat32());
      b.pitch = 0;
      b.tilt2 = b.tilt;
      b.pitch2 = 0;
      b.localOffset[1] = { ...b.localOffset[0] };
      b.yaw[1] = b.yaw[0];
    } else if (isSorterRange(b.itemId)) {
      b.tilt = fix(reader.readFloat32());
      b.pitch = fix(reader.readFloat32());
      b.localOffset[1] = readXYZ(reader);
      b.yaw[1] = fix(reader.readFloat32());
      b.tilt2 = fix(reader.readFloat32());
      b.pitch2 = fix(reader.readFloat32());
    } else {
      b.tilt = 0;
      b.pitch = 0;
      b.tilt2 = 0;
      b.pitch2 = 0;
      b.localOffset[1] = { ...b.localOffset[0] };
      b.yaw[1] = b.yaw[0];
    }
  } else if (num <= -101) {
    // 格式（V0.10.31.24646 / 2024-11-30 后）：前缀 -101，字段精简
    b = {
      index: reader.readInt32(),
      itemId: reader.readInt16(),
      modelIndex: reader.readInt16(),
      areaIndex: reader.readInt8(),
      localOffset: [readXYZ(reader)],
      yaw: [fix(reader.readFloat32())],
    };
    if (isBeltRange(b.itemId)) {
      // 传送带：仅倾角，无第二端点
      b.tilt = fix(reader.readFloat32());
      b.pitch = 0;
      b.tilt2 = b.tilt;
      b.pitch2 = 0;
      b.localOffset[1] = { ...b.localOffset[0] };
      b.yaw[1] = b.yaw[0];
    } else if (isSorterRange(b.itemId)) {
      // 分拣器：双端点 + 倾角/朝向
      b.tilt = fix(reader.readFloat32());
      b.pitch = fix(reader.readFloat32());
      b.localOffset[1] = readXYZ(reader);
      b.yaw[1] = fix(reader.readFloat32());
      b.tilt2 = fix(reader.readFloat32());
      b.pitch2 = fix(reader.readFloat32());
    } else {
      b.tilt = 0;
      b.pitch = 0;
      b.tilt2 = 0;
      b.pitch2 = 0;
      b.localOffset[1] = { ...b.localOffset[0] };
      b.yaw[1] = b.yaw[0];
    }
  } else if (num === -100) {
    // 过渡格式（V0.10.30.22239 / 2024-05-29 后）：前缀 -100，新增倾角字段
    b = {
      index: reader.readInt32(),
      areaIndex: reader.readInt8(),
      localOffset: [readXYZ(reader), readXYZ(reader)],
      yaw: [fix(reader.readFloat32()), fix(reader.readFloat32())],
      tilt: fix(reader.readFloat32()),
      pitch: 0,
      tilt2: 0,
      pitch2: 0,
      itemId: reader.readInt16(),
      modelIndex: reader.readInt16(),
    };
  } else {
    // 早期格式：无版本前缀，首个 int32 即建筑索引
    b = {
      index: num,
      areaIndex: reader.readInt8(),
      localOffset: [readXYZ(reader), readXYZ(reader)],
      yaw: [fix(reader.readFloat32()), fix(reader.readFloat32())],
      tilt: 0,
      pitch: 0,
      tilt2: 0,
      pitch2: 0,
      itemId: reader.readInt16(),
      modelIndex: reader.readInt16(),
    };
  }

  // 各格式自此后字段一致
  b.outputObjIdx = reader.readInt32();  // 输出端目标建筑索引
  b.inputObjIdx = reader.readInt32();   // 输入端目标建筑索引
  b.outputToSlot = reader.readInt8();   // 输出端绑定插槽
  b.inputFromSlot = reader.readInt8();  // 输入端绑定插槽
  b.outputFromSlot = reader.readInt8(); // 建筑自身属性
  b.inputToSlot = reader.readInt8();    // 建筑自身属性
  b.outputOffset = reader.readInt8();   // 输出端插槽偏移
  b.inputOffset = reader.readInt8();    // 输入端插槽偏移
  b.recipeId = reader.readInt16();      // 配方id
  b.filterId = reader.readInt16();      // 过滤物品id
  b.itemName = itemName(b.itemId);

  // 建筑参数（长度单位：int32）
  const paramWords = reader.readInt16();
  if (paramWords > 0) {
    const words = new Int32Array(paramWords);
    for (let i = 0; i < paramWords; i += 1) {
      words[i] = reader.readInt32();
    }
    b.parameters = getParamCodec(b.itemId).decode(words);
  } else {
    b.parameters = null;
  }

  // -102 格式独有：建筑备注
  if (num <= -102) {
    b.content = readContent(reader);
  }

  return b;
}

// 解析蓝图片区
function parseArea(reader) {
  return {
    index: reader.readInt8(),
    parentIndex: reader.readInt8(),
    tropicAnchor: reader.readInt16(),
    areaSegments: reader.readInt16(),
    anchorLocalOffset: {
      x: reader.readInt16(),
      y: reader.readInt16(),
    },
    size: {
      x: reader.readInt16(),
      y: reader.readInt16(),
    },
  };
}

// 解析地基铺设矩形（V0.10.33.26934 / 2025-09-29 后新增）
function parseReformRect(reader) {
  reader.readUInt8(); // 预留字段
  const x = reader.readInt16();
  const y = reader.readInt16();
  const w = reader.readUInt8();
  const h = reader.readUInt8();
  const data = reader.readUInt8();
  const areaIndex = reader.readUInt8();
  return {
    x,
    y,
    w,
    h,
    areaIndex,
    type: data >> 5,     // 地基装饰类型 -> 0:无地基 1-6:装饰 7:无装饰
    color: data & 0x1F,  // 颜色索引
  };
}

// 解析地基数据段
function parseReformData(reader) {
  reader.readUInt8(); // 预留字段
  const rectCount = reader.readInt32();
  if (rectCount < 0 || rectCount > 2930400) {
    throw new Error(`非法地基矩形数量：${rectCount}`);
  }
  const rects = [];
  for (let i = 0; i < rectCount; i += 1) {
    rects.push(parseReformRect(reader));
  }
  const customReformColorMask = reader.readUInt32();
  const colorCount = reader.readInt32();
  const customReformColors = [];
  for (let i = 0; i < colorCount && i < 2930400; i += 1) {
    customReformColors.push(reader.readUInt32());
  }
  return {
    rects,
    customReformColorMask,
    customReformColors,
  };
}

// 解析蓝图主体
function parseBody(reader) {
  const version = reader.readInt32();
  const cursorOffset = {
    x: reader.readInt32(),
    y: reader.readInt32(),
  };
  const cursorTargetArea = reader.readInt32();
  const dragBoxSize = {
    x: reader.readInt32(),
    y: reader.readInt32(),
  };
  const primaryAreaIdx = reader.readInt32();

  const areaCount = reader.readUInt8();
  const areas = [];
  for (let i = 0; i < areaCount; i += 1) {
    areas.push(parseArea(reader));
  }

  const buildingCount = reader.readInt32();
  const buildings = [];
  for (let i = 0; i < buildingCount; i += 1) {
    buildings.push(parseBuilding(reader));
  }

  // V0.10.33.26934（2025-09-29）后：主体版本 2，建筑数据后新增预留字段与地基数据
  let patch = 0;
  let reformData = null;
  if (version >= 2) {
    patch = reader.readInt32(); // 预留字段
    const hasReform = reader.readUInt8();
    if (hasReform !== 0) {
      reformData = parseReformData(reader);
    }
  }

  return {
    version,
    cursorOffset,
    cursorTargetArea,
    dragBoxSize,
    primaryAreaIdx,
    areas,
    buildings,
    patch,
    reformData,
  };
}

/**
 * 解析工厂蓝图字符串
 * 格式：BLUEPRINT:<头部>"<base64 gzip 主体>"<32 位签名>
 * @param {string} blueprintString
 * @returns {Promise<{
 *   header: object,
 *   version: number,
 *   cursorOffset: object,
 *   cursorTargetArea: number,
 *   dragBoxSize: object,
 *   primaryAreaIdx: number,
 *   areas: object[],
 *   buildings: object[],
 *   patch: number,
 *   reformData: (object|null),
 *   validFlag: boolean,
 * }>}
 */
async function parseBlueprintString(blueprintString) {
  if (typeof blueprintString !== 'string') {
    throw new TypeError('blueprintString must be a string');
  }

  blueprintString = blueprintString.trim().replace(/^\uFEFF/, ''); // 去除首尾空白与 UTF-8 BOM

  if (!blueprintString) {
    throw new Error('蓝图内容为空');
  }

  if (!blueprintString.startsWith(BLUEPRINT_PREFIX)) {
    throw new Error(`蓝图格式错误: 必须以 ${BLUEPRINT_PREFIX} 开头`);
  }

  const parts = getSignatureParts(blueprintString, BLUEPRINT_PREFIX);
  if (!parts) {
    throw new Error('蓝图格式错误: 未找到主体或签名');
  }

  const validFlag = parts.signature.toUpperCase() === computeSignature(parts.content);

  // 头部：前缀后到首个双引号
  const firstQuote = blueprintString.indexOf('"', BLUEPRINT_PREFIX.length);
  const headerString = blueprintString.slice(BLUEPRINT_PREFIX.length, firstQuote);
  const header = parseHeader(headerString);

  // 主体：首个双引号与末尾双引号之间
  const bodyString = blueprintString.slice(firstQuote + 1, blueprintString.length - 33);

  let body;
  try {
    const decoded = await decodeBase64Gzip(bodyString);
    const reader = new BinaryReader(decoded);
    body = parseBody(reader);

    // 主体必须被完整消费，否则说明格式理解有偏差（或游戏版本又更新了格式）。
    // 尾部全 0 字节视为无害填充（部分编码器按固定大小分配缓冲区）。
    const remain = decoded.length - reader.offset;
    if (remain !== 0) {
      let allZero = true;
      for (let i = reader.offset; i < decoded.length; i += 1) {
        if (decoded[i] !== 0) {
          allZero = false;
          break;
        }
      }
      if (!allZero) {
        throw new Error(`蓝图主体解析不完整：剩余 ${remain} 字节未解析`);
      }
    }
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : String(err);
    throw new Error(
      `${errMessage}（蓝图版本 ${header.gameVersion}${
        validFlag ? '' : '，签名不符，蓝图可能被修改'
      }）`,
      { cause: err },
    );
  }

  return {
    header,
    ...body,
    validFlag,
  };
}

export { parseBlueprintString, BLUEPRINT_PREFIX };

// Example usage:
// import { parseBlueprintString } from './factoryParser.js';
// const blueprint = await parseBlueprintString('BLUEPRINT:0,10,..."H4sI..."ABC...');
// console.log(JSON.stringify(blueprint, null, 2));

/**
 * parseBlueprintString 返回值结构（扁平对象，与参照项目 edit-dspblue-print 一致）
 *
 * {
 *   header: {
 *     layout: number,         // 蓝图图标布局 (0-9)
 *     icons: number[],        // 图标物品id（新版 5 个，旧版 2 个）
 *     createdTicks: string,   // .NET ticks（早期格式为 null）
 *     createdAt: string,      // 格式化时间
 *     gameVersion: string,    // 游戏版本号
 *     shortDesc: string,      // 缩略图文字
 *     author: string,         // 作者（0.10.32.25699+）
 *     customVersion: string,  // 自定义版本（0.10.32.25699+）
 *     externalFields: string, // 额外的新建属性（0.10.32.25699+）
 *     desc: string,           // 蓝图介绍
 *   },
 *   version: number,          // 主体版本，1 或 2（0.10.33.26934+ 为 2）
 *   cursorOffset: {x, y},     // 鼠标锚点偏移
 *   cursorTargetArea: number,
 *   dragBoxSize: {x, y},      // 拖拽复制间隔
 *   primaryAreaIdx: number,
 *   areas: Area[],            // 蓝图片区
 *   buildings: Building[],    // 建筑
 *   patch: number,            // 预留字段（version >= 2）
 *   reformData: {             // 地基铺设数据（version >= 2 且存在时）
 *     rects: [{x, y, w, h, areaIndex, type, color}],
 *     customReformColorMask: number,
 *     customReformColors: number[],
 *   } | null,
 *   validFlag: boolean,       // 签名校验结果
 * }
 *
 * Area     { index, parentIndex, tropicAnchor, areaSegments,
 *            anchorLocalOffset: {x, y}, size: {x, y} }
 * Building { index, areaIndex, localOffset: [{x,y,z}, {x,y,z}],
 *            yaw: [a, b], tilt, pitch, tilt2, pitch2,   // 倾角仅传送带/分拣器
 *            itemId, itemName, modelIndex, recipeId, filterId,
 *            outputObjIdx, inputObjIdx,                  // 传送带连接关系
 *            outputToSlot, inputFromSlot, outputFromSlot, inputToSlot,
 *            outputOffset, inputOffset,
 *            parameters: object|null,                    // 解码后的建筑参数，
 *                                                       // 未知建筑为 { _defaultParamsBase64: string }
 *            content: string|null }                      // 建筑备注（0.10.34.28281+）
 */
