import * as THREE from 'three';

function _colorIsValid(color) {
  if (!color) return false;
  return typeof color.r === 'number' || typeof color.h === 'number';
}

function _toHexColor(color, defaultColor) {
  if (!_colorIsValid(color)) return defaultColor;
  if (typeof color.r === 'number') {
    if (color.a === 0) return defaultColor;
    return (color.r << 16) | (color.g << 8) | color.b;
  }
  if (typeof color.h === 'number') {
    if (color.a === 0) return defaultColor;
    const h = color.h, s = color.s;
    const hAngle = (h * 360) % 360;
    const c = s;
    const x = c * (1 - Math.abs((hAngle / 60) % 2 - 1));
    let r = 0, g = 0, b = 0;
    if (hAngle < 60) { r = c; g = x; }
    else if (hAngle < 120) { r = x; g = c; }
    else if (hAngle < 180) { g = c; b = x; }
    else if (hAngle < 240) { g = x; b = c; }
    else if (hAngle < 300) { r = x; b = c; }
    else { r = c; b = x; }
    const m = 1 - c;
    return (Math.round((r + m) * 255) << 16) | (Math.round((g + m) * 255) << 8) | Math.round((b + m) * 255);
  }
  return defaultColor;
}

function _convertBP(coord) {
  return new THREE.Vector3(coord.x, coord.y, -coord.z);
}

function _normQuat(orbit) {
  const q = new THREE.Quaternion(orbit.x, orbit.y, orbit.z, orbit.w);
  q.normalize();
  return q;
}

function _edgeKey(id1, id2) {
  return id1 < id2 ? `${id1}-${id2}` : `${id2}-${id1}`;
}

function _getPoleBasis(pole) {
  const poleN = (pole ?? new THREE.Vector3(0, 1, 0)).clone().normalize();
  const ref = Math.abs(poleN.x) < 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const east = new THREE.Vector3().crossVectors(ref, poleN).normalize();
  if (east.lengthSq() < 1e-6) east.crossVectors(new THREE.Vector3(0, 0, 1), poleN).normalize();
  const north = new THREE.Vector3().crossVectors(poleN, east).normalize();
  return { poleN, east, north };
}

function _toLatLon(pos, pole = new THREE.Vector3(0, 1, 0)) {
  const r = pos.length();
  const { poleN, east, north } = _getPoleBasis(pole);
  const lat = Math.asin(THREE.MathUtils.clamp(pos.dot(poleN) / r, -1, 1));
  const lon = Math.atan2(pos.dot(east), pos.dot(north));
  return { lat, lon, r };
}

function _latLonToWorld(lat, lon, r, pole = new THREE.Vector3(0, 1, 0)) {
  const { poleN, east, north } = _getPoleBasis(pole);
  const cosLat = Math.cos(lat);
  return new THREE.Vector3()
    .addScaledVector(east, r * cosLat * Math.sin(lon))
    .addScaledVector(north, r * cosLat * Math.cos(lon))
    .addScaledVector(poleN, r * Math.sin(lat));
}

// ─── 几何构建 ────────────────────────────────────────────────

function _buildOrbitPoints(radius, orbit) {
  const q = _normQuat(orbit);
  const points = [];
  for (let i = 0; i <= 128; i++) {
    const theta = (i / 128) * Math.PI * 2;
    const point = new THREE.Vector3(Math.cos(theta) * radius, 0, Math.sin(theta) * radius);
    point.applyQuaternion(q);
    points.push(_convertBP(point));
  }
  return points;
}

function _createOrbitRing(radius, orbit, color = 0xffcba6, opacity = 0.9) {
  const geom = new THREE.BufferGeometry().setFromPoints(_buildOrbitPoints(radius, orbit));
  const mat = new THREE.LineBasicMaterial({ color, opacity, transparent: opacity < 1 });
  return new THREE.LineLoop(geom, mat);
}

function _createOrbitGlow(radius, orbit, color = 0xffcba6, opacity = 0.18) {
  const points = _buildOrbitPoints(radius, orbit);
  const curve = new THREE.CatmullRomCurve3(points, true);
  const geom = new THREE.TubeGeometry(curve, 100, 0.008, 8, true);
  const mat = new THREE.MeshBasicMaterial({ color, opacity, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  return new THREE.Mesh(geom, mat);
}

function _sphericalArcPoints(from, to, segments = 36) {
  const radius = (from.length() + to.length()) / 2;
  const fromN = from.clone().normalize();
  const toN = to.clone().normalize();
  const dot = THREE.MathUtils.clamp(fromN.dot(toN), -1, 1);
  const angle = Math.acos(dot);
  const axis = new THREE.Vector3().crossVectors(fromN, toN);
  if (axis.lengthSq() < 1e-6) {
    const pts = [];
    for (let i = 0; i <= segments; i++) pts.push(fromN.clone().lerp(toN, i / segments).normalize().multiplyScalar(radius));
    return pts;
  }
  axis.normalize();
  const pts = [];
  for (let i = 0; i <= segments; i++) pts.push(fromN.clone().applyAxisAngle(axis, angle * i / segments).multiplyScalar(radius));
  return pts;
}

function _gridArcPoints(from, to, segments = 18, pole = null) {
  const safePole = pole ?? new THREE.Vector3(0, 1, 0);
  const a = _toLatLon(from, safePole);
  const b = _toLatLon(to, safePole);
  const nearPoleThreshold = Math.PI / 2 - 1e-3;
  if (Math.abs(a.lat) > nearPoleThreshold) a.lon = b.lon;
  if (Math.abs(b.lat) > nearPoleThreshold) b.lon = a.lon;
  let dLon = b.lon - a.lon;
  dLon -= Math.floor(dLon / (2 * Math.PI)) * (2 * Math.PI);
  if (dLon > Math.PI) dLon -= 2 * Math.PI;
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    pts.push(_latLonToWorld(a.lat + t * (b.lat - a.lat), a.lon + t * dLon, a.r + t * (b.r - a.r), safePole));
  }
  return pts;
}

// 构建单个壳面的三角形几何（返回 { positions: 扁平数组, indices }，法线朝外）
function _buildFaceGeometry(points, pole, edgeTypes) {
  if (points.length < 3) return null;
  const spherePoints = points.map(p => p.clone());
  if (edgeTypes) {
    const refined = [];
    for (let i = 0; i < points.length; i++) {
      const from = points[i], to = points[(i + 1) % points.length];
      const sub = edgeTypes[i] === 1 && pole
        ? _gridArcPoints(from, to, 5, pole)
        : _sphericalArcPoints(from, to, 3);
      for (let j = 0; j < sub.length - 1; j++) refined.push(sub[j]);
    }
    return _buildFaceGeometry(refined, pole, null);
  }
  const vertices = [], indices = [];
  const addVertex = (v) => { vertices.push(v.x, v.y, v.z); return (vertices.length / 3) - 1; };
  const subdivide = (a, b, c, divs = 3) => {
    const ra = a.length(), rb = b.length(), rc = c.length();
    const rowIndices = [];
    for (let i = 0; i <= divs; i++) {
      const row = [];
      for (let j = 0; j <= divs - i; j++) {
        const k = divs - i - j;
        const tA = i / divs, tB = j / divs, tC = k / divs;
        const r = tA * ra + tB * rb + tC * rc;
        const pt = new THREE.Vector3().addScaledVector(a, tA).addScaledVector(b, tB).addScaledVector(c, tC).normalize().multiplyScalar(r);
        row.push(addVertex(pt));
      }
      rowIndices.push(row);
    }
    for (let i = 0; i < rowIndices.length - 1; i++) {
      const cur = rowIndices[i], nxt = rowIndices[i + 1];
      for (let j = 0; j < cur.length - 1; j++) {
        indices.push(cur[j], cur[j + 1], nxt[j]);
        if (j < cur.length - 2) indices.push(cur[j + 1], nxt[j + 1], nxt[j]);
      }
    }
  };
  function earClip(poly) {
    const tris = [], rem = poly.slice();
    function signedArea(a, b, c) { return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x); }
    function isConvex(prev, curr, next) { return signedArea(prev, curr, next) > 0; }
    function ptInTri(pt, a, b, c) { const d1 = signedArea(pt, a, b), d2 = signedArea(pt, b, c), d3 = signedArea(pt, c, a); return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0)); }
    while (rem.length > 3) {
      let found = false;
      for (let i = 0; i < rem.length; i++) {
        const prev = rem[(i - 1 + rem.length) % rem.length], curr = rem[i], next = rem[(i + 1) % rem.length];
        if (!isConvex(prev, curr, next)) continue;
        let isEar = true;
        for (let j = 0; j < rem.length; j++) { if (j === (i - 1 + rem.length) % rem.length || j === i || j === (i + 1) % rem.length) continue; if (ptInTri(rem[j], prev, curr, next)) { isEar = false; break; } }
        if (isEar) { tris.push([prev.idx, curr.idx, next.idx]); rem.splice(i, 1); found = true; break; }
      }
      if (!found) { const base = rem[0]; for (let i = 1; i < rem.length - 1; i++) tris.push([base.idx, rem[i].idx, rem[i + 1].idx]); break; }
    }
    if (rem.length === 3) tris.push([rem[0].idx, rem[1].idx, rem[2].idx]);
    return tris;
  }
  const faceNormal = new THREE.Vector3();
  for (let i = 0; i < spherePoints.length; i++) { const curr = spherePoints[i], next = spherePoints[(i + 1) % spherePoints.length]; faceNormal.x += (curr.y - next.y) * (curr.z + next.z); faceNormal.y += (curr.z - next.z) * (curr.x + next.x); faceNormal.z += (curr.x - next.x) * (curr.y + next.y); }
  faceNormal.normalize();
  const refX = Math.abs(faceNormal.x) < 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const axisU = new THREE.Vector3().crossVectors(refX, faceNormal).normalize();
  const axisV = new THREE.Vector3().crossVectors(faceNormal, axisU).normalize();
  const centroid = spherePoints.reduce((acc, p) => acc.add(p), new THREE.Vector3()).multiplyScalar(1 / spherePoints.length);
  const flat = spherePoints.map(p => { const d = p.clone().sub(centroid); return { x: d.dot(axisU), y: d.dot(axisV) }; });
  const polygon = flat.map((p, idx) => ({ x: p.x, y: p.y, idx }));
  const tris2d = earClip(polygon);
  tris2d.forEach(([ai, bi, ci]) => { if (ai < spherePoints.length && bi < spherePoints.length && ci < spherePoints.length) subdivide(spherePoints[ai], spherePoints[bi], spherePoints[ci], 3); });
  if (tris2d.length === 0) return null;
  // 确保法线统一朝外（按三角形面法线判断，必要时翻转绕序）
  let avgDot = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
    const ux = vertices[b] - vertices[a], uy = vertices[b + 1] - vertices[a + 1], uz = vertices[b + 2] - vertices[a + 2];
    const vx = vertices[c] - vertices[a], vy = vertices[c + 1] - vertices[a + 1], vz = vertices[c + 2] - vertices[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const cx = (vertices[a] + vertices[b] + vertices[c]) / 3;
    const cy = (vertices[a + 1] + vertices[b + 1] + vertices[c + 1]) / 3;
    const cz = (vertices[a + 2] + vertices[b + 2] + vertices[c + 2]) / 3;
    avgDot += nx * cx + ny * cy + nz * cz;
  }
  if (avgDot < 0) {
    for (let i = 0; i < indices.length; i += 3) {
      const tmp = indices[i + 1];
      indices[i + 1] = indices[i + 2];
      indices[i + 2] = tmp;
    }
  }
  return { positions: vertices, indices };
}

export { _colorIsValid, _toHexColor, _convertBP, _normQuat, _edgeKey, _getPoleBasis, _toLatLon, _latLonToWorld, _buildOrbitPoints, _createOrbitRing, _createOrbitGlow, _sphericalArcPoints, _gridArcPoints, _buildFaceGeometry };
