import { getCurrentTicks } from '../utils.js';
import { BinaryWriter, uint8ArrayToBase64, gzipCompress } from '../codec.js';
import { computeSignature } from '../checksum.js';
import { isBeltRange, isSorterRange } from './factoryItems.js';
import { getParamCodec } from './factoryParams.js';

// 工厂蓝图字符串固定前缀
const BLUEPRINT_PREFIX = 'BLUEPRINT:';

// 缺失版本号时的兜底版本
const DEFAULT_GAME_VERSION = '0.10.34.28524';

// 保留 4 位小数
function round4(num) {
  const v = Number(num) || 0;
  return +v.toFixed(4);
}

// 写入三维坐标
function writeXYZ(writer, coord) {
  writer.writeFloat32(round4(coord?.x));
  writer.writeFloat32(round4(coord?.y));
  writer.writeFloat32(round4(coord?.z));
}

// 规范化图标数组为 5 个
function normalizeIcons(icons) {
  const list = Array.isArray(icons) ? icons : [0, 0];
  const out = [];
  for (let i = 0; i < 5; i += 1) {
    const v = Number(list[i]);
    out.push(Number.isInteger(v) ? v : 0);
  }
  return out;
}

// 写入蓝图片区
function writeArea(writer, area) {
  writer.writeInt8(area?.index ?? 0);
  writer.writeInt8(area?.parentIndex ?? 0);
  writer.writeInt16(area?.tropicAnchor ?? 0);
  writer.writeInt16(area?.areaSegments ?? 0);
  writer.writeInt16(area?.anchorLocalOffset?.x ?? 0);
  writer.writeInt16(area?.anchorLocalOffset?.y ?? 0);
  writer.writeInt16(area?.size?.x ?? 0);
  writer.writeInt16(area?.size?.y ?? 0);
}

// 写入建筑（统一输出最新格式，前缀 -102）
function writeBuilding(writer, b) {
  const itemId = b.itemId ?? 0;

  writer.writeInt32(-102);
  writer.writeInt32(b.index ?? 0);
  writer.writeInt16(itemId);
  writer.writeInt16(b.modelIndex ?? 0);
  writer.writeInt8(b.areaIndex ?? 0);

  const p0 = b.localOffset?.[0] ?? {};
  writeXYZ(writer, p0);
  writer.writeFloat32(round4(b.yaw?.[0]));

  if (isBeltRange(itemId)) {
    // 传送带：仅倾角
    writer.writeFloat32(round4(b.tilt));
  } else if (isSorterRange(itemId)) {
    // 分拣器：双端点 + 倾角/朝向
    writer.writeFloat32(round4(b.tilt));
    writer.writeFloat32(round4(b.pitch));
    writeXYZ(writer, b.localOffset?.[1] ?? p0);
    writer.writeFloat32(round4(b.yaw?.[1] ?? b.yaw?.[0]));
    writer.writeFloat32(round4(b.tilt2));
    writer.writeFloat32(round4(b.pitch2));
  }

  writer.writeInt32(b.outputObjIdx ?? 0);
  writer.writeInt32(b.inputObjIdx ?? 0);
  writer.writeInt8(b.outputToSlot ?? 0);
  writer.writeInt8(b.inputFromSlot ?? 0);
  writer.writeInt8(b.outputFromSlot ?? 0);
  writer.writeInt8(b.inputToSlot ?? 0);
  writer.writeInt8(b.outputOffset ?? 0);
  writer.writeInt8(b.inputOffset ?? 0);
  writer.writeInt16(b.recipeId ?? 0);
  writer.writeInt16(b.filterId ?? 0);

  // 建筑参数
  let words = null;
  if (b.parameters) {
    words = getParamCodec(itemId).encode(b.parameters);
  }
  writer.writeInt16(words ? words.length : 0);
  if (words) {
    for (let i = 0; i < words.length; i += 1) {
      writer.writeInt32(words[i]);
    }
  }

  // 建筑备注（int32 长度 + 7-bit 编码长度前缀 + UTF-8）
  const content = typeof b.content === 'string' && b.content.length > 0 ? b.content : '';
  writer.writeInt32(content.length);
  if (content) {
    writer.writeString(content);
  }
}

// 写入地基铺设矩形
function writeReformRect(writer, rect) {
  writer.writeUInt8(0); // 预留字段
  writer.writeInt16(rect?.x ?? 0);
  writer.writeInt16(rect?.y ?? 0);
  writer.writeUInt8(rect?.w ?? 0);
  writer.writeUInt8(rect?.h ?? 0);
  // data：高 3 位为地基装饰类型，低 5 位为颜色索引
  writer.writeUInt8(((rect?.type ?? 0) << 5) | ((rect?.color ?? 0) & 0x1F));
  writer.writeUInt8(rect?.areaIndex ?? 0);
}

// 写入地基数据段
function writeReformData(writer, reformData) {
  writer.writeUInt8(0); // 预留字段
  const rects = reformData?.rects ?? [];
  writer.writeInt32(rects.length);
  for (const rect of rects) {
    writeReformRect(writer, rect);
  }
  writer.writeUInt32(reformData?.customReformColorMask ?? 0);
  const colors = reformData?.customReformColors ?? [];
  writer.writeInt32(colors.length);
  for (const color of colors) {
    writer.writeUInt32(color);
  }
}

// 构建头部字符串（不含前缀与引号，统一输出最新格式 flag0=1，15 字段）
function buildHeader(blueprint) {
  const header = blueprint.header ?? {};
  const layout = header.layout ?? 0;
  const icons = normalizeIcons(header.icons);
  const ticks = header.createdTicks ?? getCurrentTicks();
  const gameVersion = header.gameVersion ?? DEFAULT_GAME_VERSION;
  const shortDesc = header.shortDesc ?? '';
  const author = header.author ?? '';
  const customVersion = header.customVersion ?? '';
  const externalFields = header.externalFields ?? '';
  const desc = header.desc ?? '';

  let result = `1,${layout},${icons.join(',')},0,${ticks},${gameVersion},`;
  result += `${encodeURIComponent(shortDesc)},${encodeURIComponent(author)},`;
  result += `${encodeURIComponent(customVersion)},${encodeURIComponent(externalFields)},`;
  result += encodeURIComponent(desc);
  return result;
}

// 写入蓝图主体二进制数据
function writeBlueprintBody(blueprint) {
  const writer = new BinaryWriter();
  const version = blueprint.version ?? 2;

  writer.writeInt32(version);
  writer.writeInt32(blueprint.cursorOffset?.x ?? 0);
  writer.writeInt32(blueprint.cursorOffset?.y ?? 0);
  writer.writeInt32(blueprint.cursorTargetArea ?? 0);
  writer.writeInt32(blueprint.dragBoxSize?.x ?? 0);
  writer.writeInt32(blueprint.dragBoxSize?.y ?? 0);
  writer.writeInt32(blueprint.primaryAreaIdx ?? 0);

  const areas = blueprint.areas ?? [];
  writer.writeUInt8(areas.length);
  for (const area of areas) {
    writeArea(writer, area);
  }

  const buildings = blueprint.buildings ?? [];
  writer.writeInt32(buildings.length);
  for (const b of buildings) {
    writeBuilding(writer, b);
  }

  // 主体版本 2：预留字段 + 地基数据
  if (version >= 2) {
    writer.writeInt32(blueprint.patch ?? 0); // 预留字段
    if (blueprint.reformData && blueprint.reformData.rects?.length > 0) {
      writer.writeUInt8(1);
      writeReformData(writer, blueprint.reformData);
    } else {
      writer.writeUInt8(0);
    }
  }

  return writer.toUint8Array();
}

/**
 * 将解析结果编码回工厂蓝图字符串（与游戏互认的最新格式）
 * @param {object} blueprint parseBlueprintString 的返回值
 * @returns {Promise<string>}
 */
async function stringifyBlueprint(blueprint) {
  if (!blueprint || typeof blueprint !== 'object') {
    throw new TypeError('blueprint 必须是 parseBlueprintString 的返回值');
  }

  const headerStr = buildHeader(blueprint);
  const bodyData = writeBlueprintBody(blueprint);
  const compressed = await gzipCompress(bodyData);
  const base64Body = uint8ArrayToBase64(compressed);

  // 签名：对结尾引号之前的全部内容取摘要
  let text = `${BLUEPRINT_PREFIX}${headerStr}"${base64Body}`;
  const signature = computeSignature(text);
  text += '"';
  text += signature;
  return text;
}

export { stringifyBlueprint };
