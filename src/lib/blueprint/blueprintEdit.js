import { blueprintTypeName } from './utils.js';

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

/**
 * 从蓝图中提取指定壳层，生成单层壳蓝图
 * @param {object} blueprint - 蓝图对象（与 parseBlueprintString 返回值同构）
 * @param {number} shellId - 壳层 id
 * @returns {object} 单层壳蓝图对象 { header, body: { typeId: 1, singleShell } }
 * @throws 蓝图缺少 body、不包含 dysonShell 或壳层不存在时
 */
function extractSingleShell(blueprint, shellId) {
  const body = blueprint?.body;
  if (!body || typeof body !== 'object') {
    throw new Error('蓝图对象格式错误：缺少 body');
  }

  if (!body.dysonShell) {
    throw new Error('蓝图不包含戴森壳（需要多层壳或戴森球蓝图），无法提取壳层');
  }

  const shell = body.dysonShell.shells?.[shellId];
  if (!shell || typeof shell !== 'object') {
    throw new Error(`未找到壳层 ${shellId}`);
  }

  const copy = structuredClone(shell);
  compactAndRebuildIds(copy);

  const header = structuredClone(blueprint.header ?? {});
  header.typeId = 1;
  header.typeName = blueprintTypeName(1);

  return {
    header,
    body: { typeId: 1, singleShell: copy },
  };
}

export { cleanOrphanedComponents, compactAndRebuildIds, extractSingleShell };
