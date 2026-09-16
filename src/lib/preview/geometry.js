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

// 蓝图局部坐标 → 预览坐标（z 翻转）
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

// 壳面边界按框架类型细分
function _refineFaceBoundary(points, pole, edgeTypes, geodesicSegments = 5, gridSegments = 9) {
  const refined = [];
  for (let i = 0; i < points.length; i++) {
    const from = points[i], to = points[(i + 1) % points.length];
    const sub = edgeTypes[i] === 1 && pole
      ? _gridArcPoints(from, to, gridSegments, pole)
      : _sphericalArcPoints(from, to, geodesicSegments);
    for (let j = 0; j < sub.length - 1; j++) refined.push(sub[j]);
  }
  return refined;
}

export { _toHexColor, _convertBP, _normQuat, _edgeKey, _sphericalArcPoints, _gridArcPoints, _createOrbitRing, _createOrbitGlow, _refineFaceBoundary };
