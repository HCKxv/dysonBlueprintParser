// 向量
function _v(x, y, z) { return { x, y, z }; }
function _len(v) { return Math.hypot(v.x, v.y, v.z); }
function _norm(v) { const l = _len(v); return l < 1e-12 ? _v(0, 0, 0) : _v(v.x / l, v.y / l, v.z / l); }
function _dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
function _cross(a, b) { return _v(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x); }
function _scale(v, s) { return _v(v.x * s, v.y * s, v.z * s); }
function _clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function _sqrDist(a, b) { const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z; return dx * dx + dy * dy + dz * dz; }

// 球面线性插值
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

// 框架细分
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

const SQRT3_OVER_2 = 0.8660254037844386;
const INV_SQRT3 = 1 / Math.sqrt(3);

function _countFaceCells(faceNodes, faceFrames, radius, gridScale) {
  const nNodes = faceNodes.length;
  if (nNodes < 3) return 0;

  const polygon = [];
  for (let i = 0; i < nNodes; i++) {
    const na = faceNodes[i];
    const nb = faceNodes[(i + 1) % nNodes];
    const f = faceFrames[i];
    if (!f || !f.posA || !f.posB) {
      polygon.push(na, nb);
      continue;
    }
    const segs = f.segs || [f.posA, f.posB];
    if (f.posA === na || _sqrDist(f.posA, na) < _sqrDist(f.posB, na)) {
      for (let k = 0; k < segs.length - 1; k++) polygon.push(segs[k]);
    } else {
      for (let k = segs.length - 1; k >= 1; k--) polygon.push(segs[k]);
    }
  }
  const pCount = polygon.length;
  if (pCount < 3) return 0;

  const gridSize = gridScale * 80;
  const cpPerVertex = gridScale * gridScale * 2;
  const halfGrid = gridSize * 0.5;

  let sx = 0, sy = 0, sz = 0, ws = 0;
  for (let i = 0; i < faceFrames.length; i++) {
    const f = faceFrames[i];
    if (!f || !f.posA || !f.posB) continue;
    const a = f.posA, b = f.posB;
    const w = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    sx += (a.x + b.x) * 0.5 * w;
    sy += (a.y + b.y) * 0.5 * w;
    sz += (a.z + b.z) * 0.5 * w;
    ws += w;
  }
  if (ws < 1e-12) return 0;
  const cl = Math.hypot(sx, sy, sz);
  if (cl < 1e-12) return 0;
  const cux = sx / cl, cuy = sy / cl, cuz = sz / cl;

  const cx = cux * radius, cy = cuy * radius, cz = cuz * radius;
  let maxDist = 0;
  for (let i = 0; i < pCount; i++) {
    const p = polygon[i];
    const dx = p.x - cx, dy = p.y - cy, dz = p.z - cz;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > maxDist) maxDist = d2;
  }
  maxDist = Math.sqrt(maxDist);
  const num5 = Math.floor(maxDist / SQRT3_OVER_2 / gridSize + 2.5);

  const normal = _v(cux, cuy, cuz);
  let xaxis = _norm(_cross(normal, _v(0, 1, 0)));
  if (_len(xaxis) < 0.1) xaxis = _v(0, 0, 1);
  const yaxis = _norm(_cross(xaxis, normal));
  const xx = xaxis.x, xy = xaxis.y, xz = xaxis.z;
  const yx = yaxis.x, yy = yaxis.y, yz = yaxis.z;
  const raydir = _v(
    xx * 0.915662593339561 + yx * 0.40194777665596015,
    xy * 0.915662593339561 + yy * 0.40194777665596015,
    xz * 0.915662593339561 + yz * 0.40194777665596015
  );
  const w0x = xx * gridSize, w0y = xy * gridSize, w0z = xz * gridSize;
  const w1x = xx * (0.5 * gridSize) - yx * (SQRT3_OVER_2 * gridSize);
  const w1y = xy * (0.5 * gridSize) - yy * (SQRT3_OVER_2 * gridSize);
  const w1z = xz * (0.5 * gridSize) - yz * (SQRT3_OVER_2 * gridSize);
  const g866 = SQRT3_OVER_2 * gridSize;

  const fast = maxDist <= radius * 0.6;

  const nX = new Float64Array(pCount);
  const nY = new Float64Array(pCount);
  const nZ = new Float64Array(pCount);
  const nu = new Float64Array(pCount);
  const uX = new Float64Array(pCount);
  const uY = new Float64Array(pCount);
  const uZ = new Float64Array(pCount);
  const eX = new Float64Array(pCount);
  const eY = new Float64Array(pCount);
  const eZ = new Float64Array(pCount);
  const eLen2 = new Float64Array(pCount);
  const hgu = halfGrid / radius;
  const half2u = hgu * hgu;
  for (let q = 0; q < pCount; q++) {
    const q1 = (q + 1) % pCount;
    const p = polygon[q];
    const pl = Math.hypot(p.x, p.y, p.z);
    const v1x = p.x / pl, v1y = p.y / pl, v1z = p.z / pl;
    const p2 = polygon[q1];
    const pl2 = Math.hypot(p2.x, p2.y, p2.z);
    const v2x = p2.x / pl2, v2y = p2.y / pl2, v2z = p2.z / pl2;
    uX[q] = v1x; uY[q] = v1y; uZ[q] = v1z;
    let nx = v1y * v2z - v1z * v2y;
    let ny = v1z * v2x - v1x * v2z;
    let nz = v1x * v2y - v1y * v2x;
    const nl = Math.hypot(nx, ny, nz);
    if (nl > 1e-12) { nx /= nl; ny /= nl; nz /= nl; } else { nx = 0; ny = 0; nz = 0; }
    nX[q] = nx; nY[q] = ny; nZ[q] = nz;
    nu[q] = nx * raydir.x + ny * raydir.y + nz * raydir.z;
    const ex = v2x - v1x, ey = v2y - v1y, ez = v2z - v1z;
    eX[q] = ex; eY[q] = ey; eZ[q] = ez;
    eLen2[q] = ex * ex + ey * ey + ez * ez;
  }

  let aMinU = 0, aMaxU = 0, aMinV = 0, aMaxV = 0;
  let aArr = null, bArr = null, mMinQ = null, mMaxQ = null;
  if (fast) {
    const gU = new Float64Array(pCount);
    const gV = new Float64Array(pCount);
    for (let i = 0; i < pCount; i++) {
      const p = polygon[i];
      const pl = Math.hypot(p.x, p.y, p.z);
      const ux = p.x / pl, uy = p.y / pl, uz = p.z / pl;
      const den = ux * cux + uy * cuy + uz * cuz;
      if (den < 1e-6) return 0;
      gU[i] = radius * (ux * xx + uy * xy + uz * xz) / den;
      gV[i] = radius * (ux * yx + uy * yy + uz * yz) / den;
    }
    const sinHalf = maxDist / (2 * radius);
    const band = halfGrid / (1 - sinHalf * sinHalf);
    aMinU = gU[0] - band; aMaxU = gU[0] + band;
    aMinV = gV[0] - band; aMaxV = gV[0] + band;
    for (let i = 1; i < pCount; i++) {
      const u = gU[i], v = gV[i];
      if (u - band < aMinU) aMinU = u - band;
      if (u + band > aMaxU) aMaxU = u + band;
      if (v - band < aMinV) aMinV = v - band;
      if (v + band > aMaxV) aMaxV = v + band;
    }
    aArr = new Float64Array(pCount);
    bArr = new Float64Array(pCount);
    mMinQ = new Float64Array(pCount);
    mMaxQ = new Float64Array(pCount);
    for (let q = 0; q < pCount; q++) {
      const q1 = (q + 1) % pCount;
      const du = gU[q1] - gU[q], dv = gV[q1] - gV[q];
      const denom = du + dv * INV_SQRT3;
      if (denom > -1e-18 && denom < 1e-18) {
        mMinQ[q] = Infinity; mMaxQ[q] = -Infinity;
        aArr[q] = 0; bArr[q] = 0;
        continue;
      }
      const base = gU[q] + gV[q] * INV_SQRT3;
      const m0 = base / gridSize;
      const m1 = (base + denom) / gridSize;
      mMinQ[q] = m0 < m1 ? m0 : m1;
      mMaxQ[q] = m0 > m1 ? m0 : m1;
      aArr[q] = dv * gridSize / (denom * g866);
      bArr[q] = (gV[q] - dv * base / denom) / g866;
    }
  }

  let count = 0;
  const crossN = new Float64Array(pCount + 1);
  for (let m = -num5; m <= num5; m++) {
    const nLo = -num5 > m - num5 ? -num5 : m - num5;
    const nHi = num5 < m + num5 ? num5 : m + num5;
    let k = 0;
    if (fast) {
      for (let q = 0; q < pCount; q++) {
        if (m >= mMinQ[q] && m <= mMaxQ[q]) crossN[k++] = aArr[q] * m + bArr[q];
      }
      for (let i = 1; i < k; i++) {
        const x = crossN[i];
        let j = i - 1;
        while (j >= 0 && crossN[j] > x) { crossN[j + 1] = crossN[j]; j--; }
        crossN[j + 1] = x;
      }
    }
    let ci = 0;
    for (let n = nLo; n <= nHi; n++) {
      let inside;
      if (fast) {
        while (ci < k && crossN[ci] < n) ci++;
        inside = (ci & 1) === 1;
      } else {
        const gx = cx + w0x * m - w1x * n;
        const gy = cy + w0y * m - w1y * n;
        const gz = cz + w0z * m - w1z * n;
        const gl = Math.sqrt(gx * gx + gy * gy + gz * gz);
        const px = gx / gl, py = gy / gl, pz = gz / gl;
        inside = false;
        for (let q = 0; q < pCount; q++) {
          const d = -(nX[q] * px + nY[q] * py + nZ[q] * pz) / nu[q];
          if (d >= 0) {
            const hx = px + raydir.x * d;
            const hy = py + raydir.y * d;
            const hz = pz + raydir.z * d;
            const hl = Math.sqrt(hx * hx + hy * hy + hz * hz);
            if (hl > 1e-12) {
              const hx1 = hx / hl, hy1 = hy / hl, hz1 = hz / hl;
              const ex1 = uX[q] - hx1, ey1 = uY[q] - hy1, ez1 = uZ[q] - hz1;
              const q1 = (q + 1) % pCount;
              const ex2 = uX[q1] - hx1, ey2 = uY[q1] - hy1, ez2 = uZ[q1] - hz1;
              if (ex1 * ex2 + ey1 * ey2 + ez1 * ez2 < 0) inside = !inside;
            }
          }
        }
      }
      if (inside) { count++; continue; }
      const gx = cx + w0x * m - w1x * n;
      const gy = cy + w0y * m - w1y * n;
      const gz = cz + w0z * m - w1z * n;
      const gl = Math.sqrt(gx * gx + gy * gy + gz * gz);
      const px = gx / gl, py = gy / gl, pz = gz / gl;
      if (fast) {
        const U = gridSize * (m - n * 0.5);
        const V = g866 * n;
        if (U < aMinU || U > aMaxU || V < aMinV || V > aMaxV) continue;
      }
      for (let q = 0; q < pCount; q++) {
        const plane = nX[q] * px + nY[q] * py + nZ[q] * pz;
        if (plane > hgu || plane < -hgu) continue;
        const tx = px - uX[q], ty = py - uY[q], tz = pz - uZ[q];
        const t2 = tx * tx + ty * ty + tz * tz;
        const projT = tx * eX[q] + ty * eY[q] + tz * eZ[q];
        let d2;
        if (projT < 0) d2 = t2;
        else if (projT > eLen2[q]) {
          const ux = tx - eX[q], uy = ty - eY[q], uz = tz - eZ[q];
          d2 = ux * ux + uy * uy + uz * uz;
        } else d2 = t2 - (projT * projT) / eLen2[q];
        if (d2 <= half2u) { count++; break; }
      }
    }
  }

  return count * cpPerVertex;
}

function computeFrameStructurePoints(fr, nodeMap, R) {
  if (!fr) return null;
  const ndA = nodeMap.get(fr.relation[0]);
  const ndB = nodeMap.get(fr.relation[1]);
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

function computeShellCellPoints(fc, nodeMap, frameMap, frameDataMap, R, gridScale) {
  if (!fc || !Array.isArray(fc.relation) || fc.relation.length < 3) return null;

  const faceNodes = [];
  const faceFrames = [];
  for (let i = 0; i < fc.relation.length; i++) {
    const nid = fc.relation[i];
    const nd = nodeMap.get(nid);
    if (!nd) return null;
    const pos = _scale(_norm(_v(nd.coordinate.x, nd.coordinate.y, nd.coordinate.z)), R);
    faceNodes.push(pos);

    const nextNid = fc.relation[(i + 1) % fc.relation.length];
    const nextNd = nodeMap.get(nextNid);
    if (!nextNd) return null;
    const eKey = nid < nextNid ? nid + '-' + nextNid : nextNid + '-' + nid;
    let fd = frameDataMap.get(eKey);
    if (!fd) {
      const fr = frameMap.get(eKey);
      const ndA = fr ? nodeMap.get(fr.relation[0]) : null;
      const ndB = fr ? nodeMap.get(fr.relation[1]) : null;
      if (ndA && ndB) {
        const posA = _scale(_norm(_v(ndA.coordinate.x, ndA.coordinate.y, ndA.coordinate.z)), R);
        const posB = _scale(_norm(_v(ndB.coordinate.x, ndB.coordinate.y, ndB.coordinate.z)), R);
        fd = {
          posA,
          posB,
          segs: (fr.type ?? 0) === 1 ? _getFrameSegments({ pos: posA }, { pos: posB }, true) : null,
        };
      } else {
        fd = {
          posA: pos,
          posB: _scale(_norm(_v(nextNd.coordinate.x, nextNd.coordinate.y, nextNd.coordinate.z)), R),
          segs: null,
        };
      }
      frameDataMap.set(eKey, fd);
    }
    faceFrames.push(fd);
  }

  return _countFaceCells(faceNodes, faceFrames, R, gridScale);
}


function computeLayerPoints(sh, R) {
  // 节点映射
  const nodeMap = new Map();
  if (sh.nodes) for (let i = 1; i < sh.nodes.length; i++) {
    const nd = sh.nodes[i];
    if (!nd) continue;
    nodeMap.set(nd.id, nd);
  }

  // 框架引用映射
  const gridScale = Math.max(1, Math.round(Math.pow(R / 4000, 0.75)));
  const frameMap = new Map();
  if (sh.frames) for (const fr of sh.frames) {
    if (!fr) continue;
    const [a, b] = fr.relation;
    const key = a < b ? a + '-' + b : b + '-' + a;
    frameMap.set(key, fr);
  }
  const frameDataMap = new Map();

  // ---- 结构点数 (节点 + 框架) ----
  const node = [];
  let totalNSP = 0;
  if (sh.nodes) for (const nd of sh.nodes) {
    if (!nd) continue;
    const sp = nd.spMax ?? 30;
    totalNSP += sp;
    node.push({ id: nd.id, spMax: sp });
  }
  const frame = [];
  let totalFSP = 0;
  if (sh.frames) for (const fr of sh.frames) {
    if (!fr) continue;
    const sp = computeFrameStructurePoints(fr, nodeMap, R) ?? 0;
    totalFSP += sp;
    frame.push({ id: fr.id, spMax: sp });
  }

  // ---- 细胞点数 ----
  let totalCP = 0;
  const cells = [];
  if (sh.faces) for (const fc of sh.faces) {
    if (!fc) continue;
    const cp = computeShellCellPoints(fc, nodeMap, frameMap, frameDataMap, R, gridScale);
    if (cp != null) {
      totalCP += cp;
      cells.push({ id: fc.id, cpMax: cp });
    }
  }

  return {
    node, frame, cells,
    nodeSpMax: totalNSP, frameSpMax: totalFSP, cpMax: totalCP,
  };
}

/**
 * 计算戴森球蓝图的结构点 SP 和细胞点 CP
 *
 * @param {object} body - 解析后的蓝图数据中的 body 部分（parsed.body）
 * @param {number} [r0=10000] - 单层壳的用户输入半径（多层壳使用蓝图原始轨道半径）
 * @returns {object|null} 返回 { layers: [...], nodeSpMax, frameSpMax, cpMax }，无壳数据时返回 null
 */
function computePoints(body, r0 = 10000) {
  const isSingle = body.typeId === 1;
  let shell;
  if (isSingle) {
    shell = { shells: [body.singleShell], orbitList: [{ id: 0, radius: r0, x: 0, y: 0, z: 0, w: 1 }] };
  } else if (body.dysonShell) {
    shell = body.dysonShell;
  } else {
    return null;
  }
  if (!shell.orbitList || !shell.shells) return null;

  const layers = [];
  let tNSP = 0, tFSP = 0, tCP = 0;

  for (const orbit of shell.orbitList) {
    if (!orbit) continue;
    const sh = shell.shells[orbit.id];
    if (!sh) continue;
    const R = Number(orbit.radius);
    const layer = computeLayerPoints(sh, R);

    tNSP += layer.nodeSpMax;
    tFSP += layer.frameSpMax;
    tCP += layer.cpMax;

    layers.push({ orbitId: orbit.id, ...layer });
  }

  return {
    layers: layers,
    nodeSpMax: tNSP,
    frameSpMax: tFSP,
    cpMax: tCP,
  };
}

/**
 * 计算戴森球发电量
 *
 * 游戏内公式: (CpMax*250 + SpMax*1600)*60 * luminosity / 1000
 *
 * @param {object} points - computePoints 的返回值（含 nodeSpMax, frameSpMax, cpMax）
 * @param {number} [luminosity=1.0] - 光度系数 dysonLumino
 * @returns {number} 发电量，单位 kW
 */
function computePower(points, luminosity = 1.0, isNode = true, isFrame = true, isFaces = true) {
  let kw = 0
  if (isNode) kw += (points.nodeSpMax || 0) * 96;
  if (isFrame) kw += (points.frameSpMax || 0) * 96;
  if (isFaces) kw += (points.cpMax || 0) * 15;
  kw *= luminosity;
  return kw;
}

// 格式化小数位数
function formatValue(value) {
  if (value >= 100) return value.toFixed(0);
  if (value >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

// 格式化发电量
function fmtKW(kw) {
  if (kw < 0) return '???';
  if (kw === 0) return '0 W';
  if (kw < 1) return formatValue(kw * 1000) + ' W';
  if (kw >= 1e12) return formatValue(kw / 1e12) + ' PW';
  if (kw >= 1e9) return formatValue(kw / 1e9) + ' TW';
  if (kw >= 1e6) return formatValue(kw / 1e6) + ' GW';
  if (kw >= 1e3) return formatValue(kw / 1e3) + ' MW';
  return formatValue(kw) + ' kW';
}

export { computePoints, computePower, fmtKW };
