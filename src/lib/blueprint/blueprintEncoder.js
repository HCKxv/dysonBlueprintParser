import { compareVersion, getBodyTypeId } from './utils.js';
import { BinaryWriter, uint8ArrayToBase64, gzipCompress } from './codec.js';
import { computeSignature } from './blueprintChecksum.js';
import { compactAndRebuildIds } from './blueprintEdit.js';

// 写入三维坐标
function writeCoordinate(writer, coord) {
  writer.writeFloat32(coord.x);
  writer.writeFloat32(coord.y);
  writer.writeFloat32(coord.z);
}

// 写入 RGBA 颜色（4 字节）
function writeRGBColor(writer, color) {
  const c = color || { r: 0, g: 0, b: 0, a: 0 };
  writer.writeUInt8(c.r);
  writer.writeUInt8(c.g);
  writer.writeUInt8(c.b);
  writer.writeUInt8(c.a);
}

// 写入 HSVA 颜色（4 个 float32）
function writeHSVColor(writer, color) {
  writer.writeFloat32(color.h);
  writer.writeFloat32(color.s);
  writer.writeFloat32(color.v);
  writer.writeFloat32(color.a);
}

// 写入可见性结构（{轨道id: 可见} → uint32 位图掩码）
function writeVisibility(writer, visibility) {
  const toMask = (map) => {
    let mask = 0;
    for (const [id, visible] of Object.entries(map ?? {})) {
      if (visible) mask |= 1 << Number(id);
    }
    return mask >>> 0;
  };
  writer.writeUInt32(toMask(visibility.editor));
  writer.writeUInt32(toMask(visibility.inGame));
}

// 写入轨道数据
function writeOrbit(writer, orbit) {
  if (orbit) {
    writer.writeInt32(0); // version
    writer.writeInt32(orbit.id);
    writer.writeFloat32(orbit.radius);
    writer.writeFloat32(orbit.x);
    writer.writeFloat32(orbit.y);
    writer.writeFloat32(orbit.z);
    writer.writeFloat32(orbit.w);
    writer.writeBool(true); // hasOrbit
  } else {
    // 空轨道：写入占位数据
    writer.writeInt32(0); // version
    writer.writeInt32(0); // id
    writer.writeFloat32(0); // radius
    writer.writeFloat32(0); // x
    writer.writeFloat32(0); // y
    writer.writeFloat32(0); // z
    writer.writeFloat32(0); // w
    writer.writeBool(false); // hasOrbit
  }
}

// 写入节点数据
function writeNode(writer, node) {
  writer.writeInt32(5); // version
  writer.writeInt32(node.id);
  writer.writeInt32(node.style);
  writer.writeBool(false); // _u1
  writer.writeBool(false); // _u2
  writeCoordinate(writer, node.coordinate);
  writer.writeInt32(node.structurePoints);
  writer.writeInt32(0); // _u3 (version >= 2)
  writer.writeInt32(0); // _u4
  writer.writeInt32(0); // _u5 (version >= 1)
  writer.writeInt32(0); // _u6
  writer.writeInt32(0); // _u7 (version >= 4)
  writeRGBColor(writer, node.color); // version >= 5
}

// 写入框架数据
function writeFrame(writer, frame) {
  writer.writeInt32(1); // version
  writer.writeInt32(frame.id);
  writer.writeInt32(frame.style);
  writer.writeBool(false); // _u1
  writer.writeInt32(frame.relation[0]);
  writer.writeInt32(frame.relation[1]);
  writer.writeUInt8(frame.type);
  writer.writeInt32(0);
  writeRGBColor(writer, frame.color); // version >= 1
}

// 写入壳面数据
function writeFace(writer, face) {
  writer.writeInt32(2); // version
  writer.writeInt32(face.id);
  writer.writeInt32(face.pattern);
  writer.writeInt32(0); // _u1
  writeRGBColor(writer, face.color); // version >= 2
  writer.writeInt32(face.relation.length);
  for (let i = 0; i < face.relation.length; i += 1) {
    writer.writeInt32(face.relation[i]);
  }
}

// 写入填色网格
function writeFillGrid(writer, fillGrid) {
  writer.writeInt32(fillGrid.gridType);
  const hasColors = fillGrid.colors != null;
  writer.writeBool(hasColors);
  if (hasColors) {
    writer.writeInt32(fillGrid.colors.length);
    for (let i = 0; i < fillGrid.colors.length; i += 1) {
      writeRGBColor(writer, fillGrid.colors[i]);
    }
  }
}

// 写入组件列表（节点/框架/壳面的稀疏数组）
function writeComponentList(writer, list, writeItem) {
  const pointer = list ? list.length : 1;
  const capacity = pointer;
  const recycleCount = 0;

  writer.writeInt32(capacity);
  writer.writeInt32(pointer);
  writer.writeInt32(recycleCount);

  for (let i = 1; i < pointer; i += 1) {
    const item = list[i];
    if (item != null) {
      writer.writeInt32(item.id);
      writeItem(writer, item);
    } else {
      writer.writeInt32(0); // 空槽位
    }
  }
  // recycleCount = 0，无需写入回收 id
}

// 写入单层戴森壳
function writeSingleShell(writer, shell) {
  // 编码前清理：移除孤立引用、压缩空位、重建连续 id
  compactAndRebuildIds(shell);

  writer.writeInt32(1); // version
  writeComponentList(writer, shell.nodes, writeNode);
  writeComponentList(writer, shell.frames, writeFrame);
  writeComponentList(writer, shell.faces, writeFace);

  // version >= 1:
  if (shell.fillGrid != null) {
    writeFillGrid(writer, shell.fillGrid);
  } else {
    writer.writeInt32(0); // gridType = 0
    writer.writeBool(false); // hasColors = false
  }
}

// 写入戴森云部分
function writeDysonCloud(writer, cloud) {
  writeVisibility(writer, cloud.visibility);

  // 固定 20 路轨道
  const orbits = cloud.orbits || [];
  for (let i = 0; i < 20; i += 1) {
    writeOrbit(writer, orbits[i] || null);
  }

  // 颜色列表
  const colors = cloud.colors || [];
  writer.writeInt32(colors.length);
  for (let i = 0; i < colors.length; i += 1) {
    writeHSVColor(writer, colors[i]);
  }
}

// 写入戴森壳部分
function writeDysonShell(writer, shell) {
  writeVisibility(writer, shell.visibility);

  // 轨道列表
  const orbitList = shell.orbitList || [];
  writer.writeInt32(orbitList.length);
  for (let i = 0; i < orbitList.length; i += 1) {
    const orbit = orbitList[i];
    if (orbit != null) {
      writer.writeBool(true);
      writeOrbit(writer, orbit);
    } else {
      writer.writeBool(false);
    }
  }

  // 壳列表
  const shells = shell.shells || [];
  writer.writeInt32(shells.length);
  for (let i = 0; i < shells.length; i += 1) {
    const s = shells[i];
    if (s != null) {
      writer.writeBool(true);
      writeSingleShell(writer, s);
    } else {
      writer.writeBool(false);
    }
  }
}

// 写入蓝图主体二进制数据
function writeBlueprintBody(body) {
  const writer = new BinaryWriter();

  // 初始占位 int32
  writer.writeInt32(0);

  if (body.typeId === 3 || body.typeId === 4) {
    writeDysonCloud(writer, body.dysonCloud);
  }

  if (body.typeId === 2 || body.typeId === 4) {
    writeDysonShell(writer, body.dysonShell);
  }

  if (body.typeId === 1) {
    writeSingleShell(writer, body.singleShell);
  }

  return writer.toUint8Array();
}

const BLUEPRINT_PREFIX = 'DYBP:';

// 构建头部字符串
function buildHeader(header) {
  const ticks = header.createdTicks || '0';
  let version = header.version || '0.10.34.28524';
  // 旧版蓝图（<= 0.9.24.11286）编码时使用 0.10.34.28524
  if (compareVersion(version, '0.9.24.11286') <= 0) {
    version = '0.10.34.28524';
  }
  const typeId = header.typeId;
  const latLimit = header.latLimit || '0';
  return `0,${ticks},${version},${typeId},${latLimit}`;
}

/**
 * 将蓝图对象编码为蓝图字符串
 * @param {Object} blueprint - 蓝图对象，格式与 parseBlueprintString 的返回值一致
 * @returns {Promise<string>} 蓝图字符串，格式为 DYBP:<header>"<base64>"<signature>
 */
async function stringifyBlueprint(blueprint) {
  if (!blueprint || !blueprint.header || !blueprint.body) {
    throw new Error('蓝图对象格式错误：缺少 header 或 body');
  }

  const t = getBodyTypeId(blueprint.body)
  if ( !t ){
    throw new Error('无法识别的蓝图');
  } 
  if ( t < 1 ) {
    throw new Error(`蓝图 body 格式错误：${t}`);
  }
  blueprint.header.typeId = t;

  const headerStr = buildHeader(blueprint.header);
  const bodyData = writeBlueprintBody(blueprint.body);
  const compressed = await gzipCompress(bodyData);
  const base64Body = uint8ArrayToBase64(compressed);

  // 签名
  let text = `${BLUEPRINT_PREFIX}${headerStr}"${base64Body}`;
  const signature = computeSignature(text);
  text += '"'
  text += signature;

  return text;
}

export { stringifyBlueprint };
