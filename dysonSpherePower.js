// ===== 内部：向量 (Vector3 / VectorLF3 等价) =====
function _v(x, y, z) { return { x, y, z }; }
function _len(v) { return Math.hypot(v.x, v.y, v.z); }
function _norm(v) { const l = _len(v); return l < 1e-12 ? _v(0, 0, 0) : _v(v.x / l, v.y / l, v.z / l); }
function _dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
function _cross(a, b) { return _v(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x); }
function _add(a, b) { return _v(a.x + b.x, a.y + b.y, a.z + b.z); }
function _sub(a, b) { return _v(a.x - b.x, a.y - b.y, a.z - b.z); }
function _scale(v, s) { return _v(v.x * s, v.y * s, v.z * s); }
function _clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function _sqrDist(a, b) { const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z; return dx * dx + dy * dy + dz * dz; }

// ===== 内部：球面线性插值 (等价于 C# DysonFrame.Elerp) =====
function _elerp(a, b, t) {
  const la = _len(a), lb = _len(b);
  if (la < 1e-6 || lb < 1e-6) {
    return _v(a.x * (1 - t) + b.x * t, a.y * (1 - t) + b.y * t, a.z * (1 - t) + b.z * t);
  }
  const an = _v(a.x / la, a.y / la, a.z / la);
  const bn = _v(b.x / lb, b.y / lb, b.z / lb);
  const latA = Math.asin(an.y);
  let lonA = Math.atan2(an.z, an.x);
  const latB = Math.asin(bn.y);
  let lonB = Math.atan2(bn.z, bn.x);
  if (Math.abs(an.x) < 1e-6 && Math.abs(an.z) < 1e-6) lonA = lonB;
  if (Math.abs(bn.x) < 1e-6 && Math.abs(bn.z) < 1e-6) lonB = lonA;
  let dLon = lonB - lonA - Math.floor((lonB - lonA) / (2 * Math.PI)) * (2 * Math.PI);
  dLon = _clamp(dLon, 0, 2 * Math.PI);
  if (dLon > Math.PI) dLon -= 2 * Math.PI;
  const lat = latA * (1 - t) + latB * t;
  const lon = lonA + dLon * t;
  const r = la * (1 - t) + lb * t;
  const cosLat = Math.cos(lat);
  return _v(r * Math.cos(lon) * cosLat, r * Math.sin(lat), r * Math.sin(lon) * cosLat);
}

// ===== 内部：框架细分 (等价于 C# DysonFrame.GetSegments) =====
function _getFrameSegments(nodeA, nodeB, euler) {
  if (!euler) {
    return [nodeA.pos, nodeB.pos];
  }
  const num = 40;
  const threshold = 15;
  const raw = [];
  for (let i = 0; i < num; i++) {
    raw.push(_elerp(nodeA.pos, nodeB.pos, i / (num - 1)));
  }
  const simplified = [raw[0]];
  let lastKept = 0;
  for (let i = 1; i < num; i++) {
    let allClose = true;
    for (let j = lastKept + 1; j < i; j++) {
      const p0 = raw[lastKept], p1 = raw[i], pt = raw[j];
      const planeN = _norm(_cross(p0, p1));
      const dist = Math.abs(_dot(planeN, pt));
      if (dist > threshold) { allClose = false; break; }
    }
    if (!allClose) {
      simplified.push(raw[Math.max(i - 1, lastKept + 1)]);
      lastKept = i - 1;
    }
  }
  simplified.push(raw[num - 1]);
  const count = simplified.length;
  const result = [];
  for (let k = 0; k <= count; k++) {
    result.push(_elerp(nodeA.pos, nodeB.pos, k / count));
  }
  return result;
}

// ===== 内部：壳面六边形几何生成 (等价于 C# DysonShell.GenerateGeometry) =====
function _generateShellGeometry(faceNodes, faceFrames, radius) {
  const nNodes = faceNodes.length;
  if (nNodes < 3) return new Array(nNodes).fill(0);

  // 1. 构建多边形边界
  const polygon = [];
  for (let i = 0; i < nNodes; i++) {
    const na = faceNodes[i];
    const nb = faceNodes[(i + 1) % nNodes];
    const frame = faceFrames[i];
    if (!frame || !frame.nodeA || !frame.nodeB) {
      polygon.push(na.pos, nb.pos);
      continue;
    }
    const segs = _getFrameSegments(
      { pos: frame.nodeA.pos }, { pos: frame.nodeB.pos }, frame.euler
    );
    if (frame.nodeA.pos === na.pos || _sqrDist(frame.nodeA.pos, na.pos) < _sqrDist(frame.nodeB.pos, na.pos)) {
      for (let k = 0; k < segs.length - 1; k++) polygon.push(segs[k]);
    } else {
      for (let k = segs.length - 1; k >= 1; k--) polygon.push(segs[k]);
    }
  }
  for (let i = 0; i < polygon.length; i++) {
    const l = _len(polygon[i]);
    if (l > 1e-12) polygon[i] = _scale(polygon[i], radius / l);
  }

  // 2. 网格缩放因子
  const gridScale = Math.max(1, Math.round(Math.pow(radius / 4000, 0.75) + 0.5));
  const gridSize = gridScale * 80;
  const cpPerVertex = gridScale * gridScale * 2;

  // 3. 壳面中心 (加权平均框架中点)
  let centerSum = _v(0, 0, 0);
  let weightSum = 0;
  for (let i = 0; i < faceFrames.length; i++) {
    const f = faceFrames[i];
    if (!f || !f.nodeA || !f.nodeB) continue;
    const mid = _scale(_add(f.nodeA.pos, f.nodeB.pos), 0.5);
    const w = _len(_sub(f.nodeA.pos, f.nodeB.pos));
    centerSum = _add(centerSum, _scale(mid, w));
    weightSum += w;
  }
  let center = weightSum > 1e-12 ? _scale(centerSum, 1 / weightSum) : _scale(faceNodes[0].pos, 1);
  center = _scale(_norm(center), radius);

  // 4. 网格范围
  let maxDist = 0;
  for (let i = 0; i < polygon.length; i++) {
    const d = _len(_sub(center, polygon[i]));
    if (d > maxDist) maxDist = d;
  }
  const num4 = Math.floor(maxDist / 0.8660254037844386 / gridSize + 2.5);

  // 5. 局部坐标系
  const normal = _norm(center);
  let xaxis = _norm(_cross(normal, _v(0, 1, 0)));
  if (_len(xaxis) < 0.1) xaxis = _v(0, 0, 1);
  const yaxis = _norm(_cross(xaxis, normal));

  const w0axis = _scale(xaxis, gridSize);
  const w1axis = _sub(_scale(xaxis, 0.5 * gridSize), _scale(yaxis, 0.8660254037844386 * gridSize));
  const raydir = _add(_scale(xaxis, 0.915662593339561), _scale(yaxis, 0.40194777665596015));

  // 6. 多边形边法向量
  const pCount = polygon.length;
  const polyn = new Array(pCount);
  const polynu = new Array(pCount);
  for (let i = 0; i < pCount; i++) {
    const v1 = polygon[i];
    const v2 = polygon[(i + 1) % pCount];
    polyn[i] = _norm(_cross(v1, v2));
    polynu[i] = _dot(polyn[i], raydir);
  }

  // 7. 六边形网格生成 + point-in-polygon
  const vmap = new Map();
  const halfGrid = gridSize * 0.5;

  for (let m = -num4; m <= num4; m++) {
    for (let n = -num4; n <= num4; n++) {
      if (m - n > num4 || m - n < -num4) continue;

      const gx = center.x + w0axis.x * m - w1axis.x * n;
      const gy = center.y + w0axis.y * m - w1axis.y * n;
      const gz = center.z + w0axis.z * m - w1axis.z * n;
      const invLen = radius / Math.sqrt(gx * gx + gy * gy + gz * gz);
      const pt = _v(gx * invLen, gy * invLen, gz * invLen);

      let inside = false;
      for (let q = 0; q < pCount; q++) {
        const d = -(_dot(polyn[q], pt)) / polynu[q];
        if (d >= 0) {
          const hit = _norm(_add(pt, _scale(raydir, d)));
          const hitS = _scale(hit, radius);
          const e1 = _sub(polygon[q], hitS);
          const e2 = _sub(polygon[(q + 1) % pCount], hitS);
          const dotEE = _dot(e1, e2);
          if (dotEE < 0 || (Math.abs(dotEE) < 1e-12 && _len(e1) < 1e-12)) {
            inside = !inside;
          }
        }
      }
      const key = ((m + 10000) << 16) | (n + 10000);

      if (inside) {
        vmap.set(key, pt);
      } else {
        for (let q = 0; q < pCount; q++) {
          const es = polygon[q];
          const ee = polygon[(q + 1) % pCount];
          const edgeDir = _sub(ee, es);
          const edgeLen = _len(edgeDir);
          const edgeNorm = _norm(edgeDir);
          const toPt = _sub(pt, es);
          const proj = _dot(toPt, edgeNorm);
          let edgeDist;
          if (proj < 0) edgeDist = _len(toPt);
          else if (proj > edgeLen) edgeDist = _len(_sub(pt, ee));
          else edgeDist = _len(_sub(toPt, _scale(edgeNorm, proj)));
          if (edgeDist <= halfGrid) {
            vmap.set(key, pt);
            break;
          }
        }
      }
    }
  }

  // 8. 顶点分配至最近节点
  const verts = Array.from(vmap.values());
  const vertsCounts = new Array(nNodes).fill(0);
  const middle = Math.floor(nNodes / 2);

  for (let vi = 0; vi < verts.length; vi++) {
    let bestDist = Infinity;
    let bestIdx = 0;
    const offset = vi + 479001600;
    for (let j = 0; j < nNodes; j++) {
      let idxDiff = Math.abs((offset % nNodes) - j);
      if (idxDiff > middle) idxDiff = nNodes - idxDiff;
      const sqrD = _sqrDist(verts[vi], faceNodes[j].pos) + idxDiff;
      if (sqrD < bestDist) { bestDist = sqrD; bestIdx = j; }
    }
    vertsCounts[bestIdx]++;
  }

  // 9. 返回每个节点的细胞点数
  return vertsCounts.map(c => c * cpPerVertex);
}

// ==================== 公有 API ====================

/**
 * 计算单个框架的结构点数
 * @param {object} fr - 框架数据 (含 structureRelation)
 * @param {Map<number, object>} nodeMap - 节点映射
 * @param {number} R - 壳层半径
 * @returns {number | null} 框架 SP，计算失败返回 null
 */
export function computeFrameStructurePoints(fr, nodeMap, R) {
  if (!fr) return null;
  const ndA = nodeMap.get(fr.structureRelation[0]);
  const ndB = nodeMap.get(fr.structureRelation[1]);
  if (!ndA || !ndB) return null;

  const posA = _v(ndA.coordinate.x, ndA.coordinate.y, ndA.coordinate.z);
  const posB = _v(ndB.coordinate.x, ndB.coordinate.y, ndB.coordinate.z);
  const dotVal = _clamp(_dot(_norm(posA), _norm(posB)), -1, 1);
  const arcLen = Math.acos(dotVal) * R;
  if (isNaN(arcLen) || arcLen <= 0) return null;

  // C#: segCount = max(2, round(arcLen/600)*2)
  const segCount = Math.max(2, Math.round(arcLen / 600) * 2);
  return segCount * 10;
}

/**
 * 计算单个壳面的细胞点数
 * @param {object} fc - 壳面数据 (含 relation 节点列表)
 * @param {Map<number, object>} nodeMap - 节点映射
 * @param {Map<string, {type: number, euler: boolean}>} edgeMap - 框架类型映射
 * @param {number} R - 壳层半径
 * @returns {number | null} 壳面 CP，计算失败返回 null
 */
export function computeShellCellPoints(fc, nodeMap, edgeMap, R) {
  if (!fc || !Array.isArray(fc.relation) || fc.relation.length < 3) return null;

  const faceNodes = [];
  const faceFrames = [];
  let allValid = true;
  for (let i = 0; i < fc.relation.length; i++) {
    const nid = fc.relation[i];
    const nd = nodeMap.get(nid);
    if (!nd) { allValid = false; break; }
    const pos = _scale(_norm(_v(nd.coordinate.x, nd.coordinate.y, nd.coordinate.z)), R);
    faceNodes.push({ id: nd.id, pos, origNode: nd });

    const nextNid = fc.relation[(i + 1) % fc.relation.length];
    const nextNd = nodeMap.get(nextNid);
    if (!nextNd) { allValid = false; break; }
    const nextPos = _scale(_norm(_v(nextNd.coordinate.x, nextNd.coordinate.y, nextNd.coordinate.z)), R);

    const eKey = nid < nextNid ? nid + '-' + nextNid : nextNid + '-' + nid;
    const edgeInfo = edgeMap.get(eKey);
    faceFrames.push({
      nodeA: { pos: pos, id: nd.id },
      nodeB: { pos: nextPos, id: nextNd.id },
      euler: edgeInfo ? edgeInfo.euler : false,
      type: edgeInfo ? edgeInfo.type : 0,
    });
  }
  if (!allValid || faceNodes.length < 3) return null;

  const nodeCPs = _generateShellGeometry(faceNodes, faceFrames, R);
  return nodeCPs.reduce((a, b) => a + b, 0);
}

/**
 * 计算戴森球蓝图的结构点 SP 和细胞点 CP
 *
 * @param {object} parsed - parseBlueprintString 的解析结果
 * @param {number} [r0=10000] - 单层壳的用户输入半径（多层壳使用蓝图原始轨道半径）
 * @returns {object|null} 返回 { layers: [...], totalStructurePoints, totalCellPoints }，无壳数据时返回 null
 */
export function computePoints(parsed, r0 = 10000) {
  const isSingle = parsed.body.typeId === 1;
  let shell;
  if (isSingle) {
    shell = { shells: [parsed.body.singleShell], orbitList: [{ id: 0, radius: r0, x: 0, y: 0, z: 0, w: 1 }] };
  } else if (parsed.body.dysonShell) {
    shell = parsed.body.dysonShell;
  } else {
    return null;
  }
  if (!shell.orbitList || !shell.shells) return null;

  const layers = [];
  let tSP = 0, tCP = 0;

  for (const orbit of shell.orbitList) {
    if (!orbit) continue;
    const sh = shell.shells[orbit.id];
    if (!sh) continue;
    const R = orbit.radius;

    // 节点映射
    const nodeMap = new Map();
    if (sh.nodes) for (let i = 1; i < sh.nodes.length; i++) {
      const nd = sh.nodes[i];
      if (!nd) continue;
      nodeMap.set(nd.id, nd);
    }

    // 框架类型映射
    const edgeMap = new Map();
    if (sh.frames) for (const fr of sh.frames) {
      if (!fr) continue;
      const [a, b] = fr.structureRelation;
      const key = a < b ? a + '-' + b : b + '-' + a;
      edgeMap.set(key, { type: fr.type ?? 0, euler: (fr.type ?? 0) === 1 });
    }

    const validNodes = sh.nodes ? sh.nodes.filter(Boolean) : [];
    const nCnt = validNodes.length;

    // ---- 节点结构点：使用蓝图内置值 (C#: r.ReadInt32()) ----
    let nodeSP = 0;
    for (const nd of validNodes) {
      nodeSP += nd.structurePoints ?? 30;
    }

    // ---- 框架结构点 ----
    const structures = [];
    let frameSP = 0;
    if (sh.frames) for (const fr of sh.frames) {
      const sp = computeFrameStructurePoints(fr, nodeMap, R);
      if (sp != null) {
        frameSP += sp;
        structures.push({ id: fr.id, structurePoints: sp });
      }
    }

    // ---- 细胞点数 ----
    let cellPts = 0;
    const cells = [];
    if (sh.faces) for (const fc of sh.faces) {
      const cp = computeShellCellPoints(fc, nodeMap, edgeMap, R);
      if (cp != null) { cellPts += cp; cells.push({ id: fc.id, cellPoints: cp }); }
    }

    const lSP = nodeSP + frameSP;
    tSP += lSP;
    tCP += cellPts;

    layers.push({
      orbitId: orbit.id, radius: R, nodeCount: nCnt,
      nodeStructurePoints: nodeSP,
      structures, cells,
      totalStructurePoints: lSP, totalCellPoints: cellPts,
    });
  }

  return {
    layers: layers.filter(l => l.totalStructurePoints > 0 || l.totalCellPoints > 0),
    totalStructurePoints: tSP,
    totalCellPoints: tCP,
  };
}

/**
 * 计算戴森球发电量
 *
 * 游戏内公式: (CpMax*250 + SpMax*1600)*60 * luminosity / 1000
 *
 * @param {object} points - computePoints 的返回值（含 totalStructurePoints, totalCellPoints）
 * @param {number} [luminosity=1.0] - 光度系数 dysonLumino
 * @returns {number} 发电量，单位 kW
 */
export function computePower(points, luminosity = 1.0) {
  return ((points.totalStructurePoints || 0) * 96 + (points.totalCellPoints || 0) * 15) * luminosity;
}
