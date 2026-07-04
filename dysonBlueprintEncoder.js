// 与 dysonBlueprintParser.js 配对使用：parseBlueprintString 解析，stringifyBlueprint 编码

import { digest } from './md5.js';

// 二进制写入器，用于按小端序写入各种基础类型到 Uint8Array
class BinaryWriter {
  constructor(initialCapacity = 4096) {
    this.buffer = new ArrayBuffer(initialCapacity);
    this.view = new DataView(this.buffer);
    this.offset = 0;
  }

  _ensureCapacity(additionalBytes) {
    const needed = this.offset + additionalBytes;
    if (needed > this.buffer.byteLength) {
      let newCapacity = this.buffer.byteLength * 2;
      while (newCapacity < needed) newCapacity *= 2;
      const newBuffer = new ArrayBuffer(newCapacity);
      new Uint8Array(newBuffer).set(new Uint8Array(this.buffer));
      this.buffer = newBuffer;
      this.view = new DataView(this.buffer);
    }
  }

  writeInt32(value) {
    this._ensureCapacity(4);
    this.view.setInt32(this.offset, value, true);
    this.offset += 4;
  }

  writeUInt32(value) {
    this._ensureCapacity(4);
    this.view.setUint32(this.offset, value, true);
    this.offset += 4;
  }

  writeFloat32(value) {
    this._ensureCapacity(4);
    this.view.setFloat32(this.offset, value, true);
    this.offset += 4;
  }

  writeUInt8(value) {
    this._ensureCapacity(1);
    this.view.setUint8(this.offset, value & 0xFF);
    this.offset += 1;
  }

  writeBool(value) {
    this.writeUInt8(value ? 1 : 0);
  }

  toUint8Array() {
    return new Uint8Array(this.buffer, 0, this.offset);
  }
}

// 将 Uint8Array 编码为 Base64 字符串
function uint8ArrayToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// 对文本计算 MD5 签名，返回大写十六进制字符串
function computeSignature(text) {
  const bytes = new TextEncoder().encode(text);
  const hashBuffer = digest(new Uint8Array(bytes).buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).toUpperCase().padStart(2, '0'))
    .join('');
}

// 使用 gzip 压缩数据
async function gzipCompress(data) {
  if (typeof CompressionStream === 'function') {
    const cs = new CompressionStream('gzip');
    const writer = cs.writable.getWriter();
    writer.write(data);
    writer.close();
    const arrayBuffer = await new Response(cs.readable).arrayBuffer();
    return new Uint8Array(arrayBuffer);
  }

  if (typeof pako !== 'undefined' && typeof pako.gzip === 'function') {
    return pako.gzip(data);
  }

  throw new Error('浏览器不支持 gzip 压缩，请使用 Edge 或 Chrome 浏览器。');
}

// ---- 壳组件清理与重建 ----

// 将无序节点对编码为字符串 key，用于集合查找
function edgeKey(a, b) {
  return a < b ? `${a},${b}` : `${b},${a}`;
}

// 清理框架中引用已删除节点的项，以及壳面中边不在框架中的项
function cleanOrphanedComponents(shell) {
  // 收集所有有效节点 id
  const nodeIds = new Set();
  const nodes = shell.nodes;
  for (let i = 1; i < nodes.length; i += 1) {
    if (nodes[i] != null) {
      nodeIds.add(nodes[i].id);
    }
  }

  // 清理框架：引用的节点不存在 → 标记为 null
  const frames = shell.frames;
  for (let i = 1; i < frames.length; i += 1) {
    const frame = frames[i];
    if (frame == null) continue;
    if (!frame.relation.every(pid => nodeIds.has(pid))) {
      frames[i] = null;
    }
  }

  // 收集所有有效框架端点（无序节点对）
  const frameEndpoints = new Set();
  for (let i = 1; i < frames.length; i += 1) {
    const frame = frames[i];
    if (frame == null) continue;
    frameEndpoints.add(edgeKey(frame.relation[0], frame.relation[1]));
  }

  // 清理壳面：少于 2 个节点，或任一边不在框架端点集合中 → 标记为 null
  const faces = shell.faces;
  for (let i = 1; i < faces.length; i += 1) {
    const face = faces[i];
    if (face == null) continue;
    const rel = face.relation;
    if (rel.length < 2) {
      faces[i] = null;
      continue;
    }
    // 构建壳面的所有边（相邻节点对，含首尾闭合边）
    const edges = [];
    for (let j = 0; j < rel.length - 1; j += 1) {
      edges.push(edgeKey(rel[j], rel[j + 1]));
    }
    edges.push(edgeKey(rel[rel.length - 1], rel[0]));

    if (!edges.every(e => frameEndpoints.has(e))) {
      faces[i] = null;
    }
  }
}

// 移除空位，重建连续 id，更新所有引用关系
function compactAndRebuildIds(shell) {
  cleanOrphanedComponents(shell);

  // 重建节点列表，建立旧→新 id 映射
  const nodeIdMap = {};
  const newNodes = [null];
  let newNodeId = 1;
  for (let i = 1; i < shell.nodes.length; i += 1) {
    const node = shell.nodes[i];
    if (node == null) continue;
    nodeIdMap[node.id] = newNodeId;
    newNodes.push({ ...node, id: newNodeId });
    newNodeId += 1;
  }

  // 通用重建函数：过滤空位，更新节点引用，重新分配连续 id
  function rebuildList(oldList) {
    const newList = [null];
    let newId = 1;
    for (let i = 1; i < oldList.length; i += 1) {
      const item = oldList[i];
      if (item == null) continue;
      const newRelation = item.relation.map(pid => nodeIdMap[pid]);
      newList.push({ ...item, id: newId, relation: newRelation });
      newId += 1;
    }
    return newList;
  }

  shell.nodes = newNodes;
  shell.frames = rebuildList(shell.frames);
  shell.faces = rebuildList(shell.faces);

  // 涂色网格颜色全为默认值 (0,0,0,0) 时清空
  if (shell.fillGrid && shell.fillGrid.colors) {
    if (shell.fillGrid.colors.every(c => c.r === 0 && c.g === 0 && c.b === 0 && c.a === 0)) {
      shell.fillGrid.colors = null;
    }
  }
}

// ---- 写入各组件类型的函数 ----

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

// 写入可见性结构
function writeVisibility(writer, visibility) {
  writer.writeUInt32(visibility.editor);
  writer.writeUInt32(visibility.inGame);
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
  writer.writeInt32(frame.structurePoints);
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

// 构建头部字符串
function buildHeader(header) {
  const ticks = header.createdTicks || '0';
  const version = header.version || '0.10.34.28524';
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

  blueprint.header.typeId = blueprint.body.typeId

  const headerStr = buildHeader(blueprint.header);
  const bodyData = writeBlueprintBody(blueprint.body);
  const compressed = await gzipCompress(bodyData);
  const base64Body = uint8ArrayToBase64(compressed);

  // 签名
  let text = `DYBP:${headerStr}"${base64Body}`;
  const signature = computeSignature(text);
  text += '"'
  text += signature;

  return text;
}

export { stringifyBlueprint, cleanOrphanedComponents, compactAndRebuildIds };
