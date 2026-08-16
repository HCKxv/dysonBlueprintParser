/**
 * DysonSpherePreview — 戴森球蓝图 3D 预览模块
 *
 *
 *  预览实例:  new DysonSpherePreview()
 *
 *   1. init(canvas)                  初始化场景（相机、渲染器、光照、控制器、刻度网格）
 *   2. render(data)                  根据已解析的蓝图数据重建 3D 场景
 *   3. setLayerVisible(type, id, v)  壳层 / 云轨道显示控制  (type: 'shell' | 'cloud')
 *   4. setGridVisible(visible)       刻度显示开关
 *   5. setRotationEnabled(enabled)   旋转开关
 *   6. setRotationSpeed(speed)       转速修改（建议 0.01 慢 / 0.05 中 / 0.20 快）
 *   7. setSunColor(luminosity)       根据光度系数更新恒星颜色
 *   8. setPaintingVisible(visible)   涂色网格显示开关
 *
 *   辅助:
 *     clearScene()                   清空场景中的所有 3D 对象
 *     resize()                       手动触发渲染器大小调整
 *     dispose()                      销毁实例，释放资源
 *
 *   render(body) 的 body 结构（即 parsed.body）:
 *    {
 *      typeId: 1|2|3|4,
 *      singleShell: { nodes, frames, faces, fillGrid? },  // typeId=1
 *      dysonShell: {
 *        orbitList: [{ id, radius, x, y, z, w }],
 *        shells: { [id]: { nodes, frames, faces, fillGrid? } },
 *        visibility?: { editor, inGame }
 *      },
 *      dysonCloud: {
 *        orbits: [{ id, radius, x, y, z, w }],
 *        colors?: { [id]: color },
 *        visibility?: { editor, inGame }
 *      }
 *    }
 *
 *   其中
 *   color: { r,g,b,a } | { h,s,v,a }
 *   节点 node:  { id, coordinate: { x, y, z }, color, style? }
 *   框架 frame: { id, relation: [nodeId, nodeId], color, type, style? }     type: 0=测地线  1=经纬线
 *   壳面 face:  { id, relation: [nodeId, nodeId, ...], color, pattern? }    有序节点 ID 列表构成多边形
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildPaintingGeometry } from './dysonPaintingGrid.js';

// 涂色裁剪模板值基准: 每层壳面写入自己层的值、该层涂色只测试自己层的值
// （与游戏一致: 壳面写 _Stencil = layerId+200，涂色层测试同值；跨层叠加靠深度缓冲遮挡）
const STENCIL_BASE = 200;

// ═══════════════════════════════════════════════════════════════
// 恒星光谱型颜色表
//   从低温到高温: M < K < G < F < A < B < O
//   back: 壳层内衬背景色（恒星盘面暗部）
//   core: 恒星本体/光晕发光色
//   分档为开区间: 光度 lum < maxLum 归入该型
// ═══════════════════════════════════════════════════════════════
const STAR_TYPE_COLORS = [
  { type: 'M', maxLum: 0.90, back: 0xB28174, core: 0xFF4032 },
  { type: 'K', maxLum: 0.98, back: 0xB29886, core: 0xFF7842 },
  { type: 'G', maxLum: 1.08, back: 0xB2A886, core: 0xFFED2A },
  { type: 'F', maxLum: 1.25, back: 0xB1B29D, core: 0xF9FF99 },
  { type: 'A', maxLum: 1.55, back: 0xAAB0B2, core: 0xFFFFFF },
  { type: 'B', maxLum: 2.00, back: 0x8198B2, core: 0x55A2FF },
  { type: 'O', maxLum: Infinity, back: 0x748BB2, core: 0x2E47FF },
];

/**
 * 按光度系数取恒星配色
 * @param {number} luminosity  光度系数
 * @returns {{type: string, maxLum: number, back: number, core: number}}
 */
function getStarColors(luminosity) {
  return STAR_TYPE_COLORS.find(s => luminosity < s.maxLum)
    ?? STAR_TYPE_COLORS[STAR_TYPE_COLORS.length - 1];
}

// ═══════════════════════════════════════════════════════════════
// 内部工具函数
// ═══════════════════════════════════════════════════════════════

function _isVisible(visibilityMask, index) {
  return (visibilityMask >>> index) & 1;
}

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

// ═══════════════════════════════════════════════════════════════
// DysonSpherePreview
// ═══════════════════════════════════════════════════════════════

class DysonSpherePreview {
  constructor() {
    this._scene = null;
    this._camera = null;
    this._renderer = null;
    this._controls = null;
    this._canvas = null;

    this._rootGroup = null;
    this._gridGroup = null;
    this._axesHelper = null;
    this._originSphere = null;
    this._starGlowInner = null;

    this._shellGroups = [];
    this._paintingMeshes = [];
    this._paintingVisible = true;
    this._shellRotationEnabled = true;
    this._shellSpeed = 0.05;
    this._currentScale = 1;
    this._clock = new THREE.Clock();
    this._animFrameId = null;
    this._needsRender = true;   // 脏标记: 旋转/交互/场景变化时置位，静止时跳过渲染（省电）
    this._resizeObserver = null;

    this._visObjects = new Map();
    this._nodeGeom = new THREE.SphereGeometry(1, 8, 8);
    this._sharedBackMaterial = new THREE.MeshBasicMaterial({ color: getStarColors(1.0).back, opacity: 1, transparent: true, side: THREE.BackSide, depthWrite: true });

    // 绑定的事件回调引用，用于 dispose
    this._onBlur = null;
  }

  // ─── 1. 初始化场景 ─────────────────────────────────────────

  /**
   * @param {HTMLCanvasElement} canvas
   */
  init(canvas) {
    this._canvas = canvas;

    this._scene = new THREE.Scene();
    this._scene.background = new THREE.Color(0x3F5C6A);

    this._camera = new THREE.PerspectiveCamera(40, 1, 0.1, 1000);
    this._camera.position.set(0, 1.8, -3.2);

    this._renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this._renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);

    this._controls = new OrbitControls(this._camera, canvas);
    this._controls.enableDamping = true;
    this._controls.enablePan = false;
    this._controls.minDistance = 0.8;
    this._controls.maxDistance = 20;
    this._controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: null };
    // 相机交互（含阻尼惯性）时置脏
    this._controls.addEventListener('change', () => { this._needsRender = true; });

    // 指针丢失兜底
    canvas.addEventListener('lostpointercapture', (e) => {
      canvas.dispatchEvent(new PointerEvent('pointerup', { pointerId: e.pointerId }));
    });
    this._onBlur = () => {
      for (let i = 0; i < 10; i++) canvas.dispatchEvent(new PointerEvent('pointerup', { pointerId: i }));
    };
    window.addEventListener('blur', this._onBlur);

    // resize: 用 ResizeObserver 监听容器尺寸（替代每帧读取 clientWidth + window resize）
    this._resizeObserver = new ResizeObserver(() => {
      this.resize();
      this._needsRender = true;
    });
    this._resizeObserver.observe(canvas.parentElement || canvas);

    // 光照
    this._scene.add(new THREE.AmbientLight(0xffffff, 1.2));

    // 根组
    this._rootGroup = new THREE.Group();
    this._scene.add(this._rootGroup);

    // 刻度网格
    this._gridGroup = new THREE.Group();
    this._gridGroup.name = 'longitudeGrid';
    this._scene.add(this._gridGroup);

    this._createLongitudeGrid(1.2);

    // 坐标轴
    this._axesHelper = new THREE.AxesHelper(0.05);
    this._axesHelper.material.depthTest = false;
    this._axesHelper.renderOrder = 2;
    this._scene.add(this._axesHelper);

    // 恒星
    this._originSphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 48, 24),
      new THREE.MeshBasicMaterial({ color: getStarColors(1.0).core })
    );
    this._scene.add(this._originSphere);

    // 光晕
    this._starGlowInner = new THREE.Mesh(
      new THREE.SphereGeometry(0.068, 32, 16),
      new THREE.MeshBasicMaterial({ color: getStarColors(1.0).core, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    this._scene.add(this._starGlowInner);

    this._startLoop();
  }

  // ─── 2. 渲染蓝图数据 ───────────────────────────────────────

  /**
   * @param {object} body — 解析后的蓝图数据中的 body 部分（parsed.body）
   *
   * body.typeId         1=单层壳  2=多层壳  3=戴森云  4=壳+云
   * body.singleShell    { nodes, frames, faces, fillGrid? }
   * body.dysonShell     { orbitList, shells, visibility? }
   * body.dysonCloud     { orbits, colors?, visibility? }
   */
  render(body) {
    this.clearScene();
    this._paintingMeshes = [];

    const isSingleShell = body.typeId === 1;
    const cloud = body.dysonCloud;
    const shell = isSingleShell
      ? { shells: [body.singleShell], orbitList: [{ id: 0, radius: 10000.0, x: 0, y: 0, z: 0, w: 1 }] }
      : (body.dysonShell ?? null);

    // 计算缩放
    const shellRadii = shell?.orbitList?.filter(Boolean).map(o => o.radius) ?? [];
    const cloudRadii = cloud?.orbits?.filter(Boolean).map(o => o.radius) ?? [];
    const allRadii = shellRadii.concat(cloudRadii);
    let maxRadius;
    if (allRadii.length > 0) {
      maxRadius = Math.max(1, ...allRadii);
    } else if (shell?.shells?.[0]?.nodes) {
      maxRadius = Math.max(1, ...shell.shells[0].nodes.slice(1).filter(Boolean).map(n => Math.hypot(n.coordinate.x, n.coordinate.y, n.coordinate.z)));
    } else {
      maxRadius = 1;
    }
    this._currentScale = 1 / maxRadius;

    // ── 云轨道 ──
    if (cloud?.orbits) {
      cloud.orbits.forEach((orb, idx) => {
        if (!orb) return;
        const gv = cloud.visibility ? !!_isVisible(cloud.visibility.inGame, orb.id) : true;
        const r = orb.radius * this._currentScale;
        const e = cloud.colors?.[orb.id] ?? cloud.colors?.[orb.id - 1] ?? cloud.colors?.[idx];
        const ring = _createOrbitRing(r, orb, _toHexColor(e, 0xffcba6), 0.9);
        ring.name = 'cloud-orbit-' + idx; ring.visible = gv;
        this._visObjects.set('cloud_' + orb.id, ring); this._rootGroup.add(ring);
        const glow = _createOrbitGlow(r, orb, _toHexColor(e, 0xffcba6), 0.18);
        glow.name = 'cloud-glow-' + idx; glow.visible = gv;
        this._visObjects.set('cloud_glow_' + orb.id, glow); this._rootGroup.add(glow);
      });
    }

    // ── 壳层 ──
    if (shell?.orbitList) {
      for (let i = 0; i < shell.orbitList.length; i++) {
        const orbit = shell.orbitList[i];
        if (!orbit) continue;
        const shData = shell.shells?.[orbit.id] ?? null;
        if (!shData) continue;
        const gv = shell.visibility ? !!_isVisible(shell.visibility.inGame, orbit.id) : true;
        const renderR = orbit.radius;
        const shQuat = _normQuat(orbit);
        const poleRaw = new THREE.Vector3(0, 1, 0); poleRaw.applyQuaternion(shQuat);
        const shPole = _convertBP(poleRaw);
        const shellGroup = new THREE.Group();
        this._shellGroups.push({ group: shellGroup, pole: shPole.clone().normalize(), radius: renderR });
        // 本层专属模板值（与游戏一致: layerId+200）
        const stencilRef = STENCIL_BASE + (orbit.id || 0);

        const nodeMap = new Map();
        const nodeData = [];
        if (shData.nodes) {
          for (let ni = 1; ni < shData.nodes.length; ni++) {
            const nd = shData.nodes[ni];
            if (!nd) continue;
            const d = new THREE.Vector3(nd.coordinate.x, nd.coordinate.y, nd.coordinate.z).normalize();
            d.applyQuaternion(shQuat);
            const pos = _convertBP(d).multiplyScalar(renderR * this._currentScale);
            nodeMap.set(nd.id, pos);
            nodeData.push({ pos, color: _toHexColor(nd.color, 0x60D6FD) });
          }
        }
        // 节点: InstancedMesh 合并为一次绘制
        if (nodeData.length) {
          const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x0a2f20, metalness: 0.2, roughness: 0.6 });
          const inst = new THREE.InstancedMesh(this._nodeGeom, mat, nodeData.length);
          const m4 = new THREE.Matrix4();
          const c = new THREE.Color();
          const s = 50 * this._currentScale;
          nodeData.forEach((nd, i) => {
            m4.makeScale(s, s, s);
            m4.setPosition(nd.pos.x, nd.pos.y, nd.pos.z);
            inst.setMatrixAt(i, m4);
            inst.setColorAt(i, c.setHex(nd.color));
          });
          inst.instanceMatrix.needsUpdate = true;
          if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
          shellGroup.add(inst);
        }

        // 框架: 合并为一条 LineSegments（顶点色）
        const colorCache = new Map();
        const hexColor = (hex) => {
          let c = colorCache.get(hex);
          if (!c) { c = new THREE.Color(hex); colorCache.set(hex, c); }
          return c;
        };
        const framePts = [];
        const frameCols = [];
        const renderedEdges = new Set();
        const ftMap = new Map();
        const re = (id1, id2, color, type = 0) => {
          const k = _edgeKey(id1, id2);
          if (renderedEdges.has(k)) return;
          renderedEdges.add(k);
          const f = nodeMap.get(id1), t = nodeMap.get(id2);
          if (!f || !t) return;
          const pts = (type === 1 && shPole) ? _gridArcPoints(f, t, 18, shPole) : _sphericalArcPoints(f, t, 18);
          const c = hexColor(color);
          for (let i = 0; i < pts.length - 1; i++) {
            framePts.push(pts[i].x, pts[i].y, pts[i].z, pts[i + 1].x, pts[i + 1].y, pts[i + 1].z);
            frameCols.push(c.r, c.g, c.b, c.r, c.g, c.b);
          }
        };
        if (shData.frames) {
          shData.frames.forEach(fr => {
            if (!fr) return;
            const k = _edgeKey(fr.relation[0], fr.relation[1]);
            ftMap.set(k, fr.type);
            re(fr.relation[0], fr.relation[1], _toHexColor(fr.color, 0x175473), fr.type);
          });
        }
        if (framePts.length) {
          const geom = new THREE.BufferGeometry();
          geom.setAttribute('position', new THREE.Float32BufferAttribute(framePts, 3));
          geom.setAttribute('color', new THREE.Float32BufferAttribute(frameCols, 3));
          shellGroup.add(new THREE.LineSegments(geom, new THREE.LineBasicMaterial({ vertexColors: true, opacity: 0.5, transparent: true })));
        }

        // 壳面: 合并为共享几何（正面顶点色，背面共享材质复用同一几何）
        const faceVerts = [];
        const faceCols = [];
        const faceIdx = [];
        if (shData.faces) {
          shData.faces.forEach(fc => {
            if (!fc || !Array.isArray(fc.relation) || fc.relation.length < 3) return;
            if (fc.relation.some(nid => !nodeMap.has(nid))) return;
            const rel = fc.relation.slice();
            const pts = rel.map(nid => nodeMap.get(nid));
            if (pts.some(p => !p)) return;
            const edgeTypes = rel.map((_, j) => ftMap.get(_edgeKey(rel[j], rel[(j + 1) % rel.length])) ?? 0);
            const fg = _buildFaceGeometry(pts, shPole, edgeTypes);
            if (!fg) return;
            const base = faceVerts.length / 3;
            const c = hexColor(_toHexColor(fc.color, 0x175473));
            for (let i = 0; i < fg.positions.length; i += 3) {
              faceVerts.push(fg.positions[i], fg.positions[i + 1], fg.positions[i + 2]);
              faceCols.push(c.r, c.g, c.b);
            }
            for (const i of fg.indices) faceIdx.push(base + i);
          });
        }
        if (faceVerts.length) {
          const geom = new THREE.BufferGeometry();
          geom.setAttribute('position', new THREE.Float32BufferAttribute(faceVerts, 3));
          geom.setAttribute('color', new THREE.Float32BufferAttribute(faceCols, 3));
          geom.setIndex(faceIdx);
          geom.computeVertexNormals();
          const mat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.FrontSide, depthWrite: true });
          // 壳面写入本层模板值（与游戏一致: 壳面写 _Stencil = layerId+200，涂色层测试同值）
          mat.stencilWrite = true;
          mat.stencilWriteMask = 0xff;
          mat.stencilRef = stencilRef;
          mat.stencilFunc = THREE.AlwaysStencilFunc;
          mat.stencilZPass = THREE.ReplaceStencilOp;
          const group = new THREE.Group();
          group.add(new THREE.Mesh(geom, mat));
          group.add(new THREE.Mesh(geom, this._sharedBackMaterial)); // BackSide 复用同一几何
          shellGroup.add(group);
        }

        // ── 涂色网格 (fillGrid) ──
        if (shData.fillGrid?.colors) {
          const parts = buildPaintingGeometry(shData.fillGrid);
          if (parts) {
            const paintR = renderR * this._currentScale * 1.0015; // 略高于壳面避免重叠闪烁
            for (const part of parts) {
              const geom = new THREE.BufferGeometry();
              const posAttr = new THREE.Float32BufferAttribute(part.positions, 3);
              const colAttr = new THREE.Float32BufferAttribute(part.colors, 4);
              // 与节点相同的坐标变换: 游戏局部空间 → 轨道四元数 → 预览空间
              // （纯标量四元数旋转 + z 翻转，避免每顶点分配 Vector3 对象）
              const qx = shQuat.x, qy = shQuat.y, qz = shQuat.z, qw = shQuat.w;
              for (let vi = 0; vi < posAttr.count; vi += 1) {
                const x = posAttr.getX(vi), y = posAttr.getY(vi), z = posAttr.getZ(vi);
                const tx = 2 * (qy * z - qz * y);
                const ty = 2 * (qz * x - qx * z);
                const tz = 2 * (qx * y - qy * x);
                const rx = x + qw * tx + (qy * tz - qz * ty);
                const ry = y + qw * ty + (qz * tx - qx * tz);
                const rz = z + qw * tz + (qx * ty - qy * tx);
                posAttr.setXYZ(vi, rx * paintR, ry * paintR, -rz * paintR);
              }
              geom.setAttribute('position', posAttr);
              geom.setAttribute('color', colAttr);
              const mat = new THREE.MeshBasicMaterial({
                vertexColors: true,
                transparent: true,
                depthWrite: true,
                side: THREE.FrontSide, // 单面渲染，避免正反双面叠加导致超亮发光翻倍发白
                blending: part.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
              });
              // 仅在本层壳面区域内显示: 测试本层壳面写入的模板值（r161 中 stencilWrite=true 才开启模板测试，写入掩码 0 只测不写）
              mat.stencilWrite = true;
              mat.stencilWriteMask = 0x00;
              mat.stencilRef = stencilRef;
              mat.stencilFunc = THREE.EqualStencilFunc;
              const mesh = new THREE.Mesh(geom, mat);
              mesh.renderOrder = 3;
              mesh.frustumCulled = false;
              mesh.visible = this._paintingVisible;
              shellGroup.add(mesh);
              this._paintingMeshes.push(mesh);
            }
          }
        }

        shellGroup.visible = gv;
        this._visObjects.set('shell_' + orbit.id, shellGroup);
        this._rootGroup.add(shellGroup);
      }
    }

    this._camera.position.set(0, 1.8, -3.2);
    this._controls.target.set(0, 0, 0);
    this._controls.update();
    this._needsRender = true; // 新蓝图渲染完成后置脏
  }

  // ─── 3. 壳层与云轨道显示控制 ───────────────────────────────

  /**
   * @param {'shell'|'cloud'} type
   * @param {number} id  轨道 ID
   * @param {boolean} visible
   */
  setLayerVisible(type, id, visible) {
    const key = type + '_' + id;
    const obj = this._visObjects.get(key);
    if (obj) obj.visible = visible;
    const glow = this._visObjects.get(key.replace(/^cloud_/, 'cloud_glow_'));
    if (glow) glow.visible = visible;
    this._needsRender = true;
  }

  // ─── 4. 刻度显示开关 ───────────────────────────────────────

  /**
   * @param {boolean} visible
   */
  setGridVisible(visible) {
    if (this._gridGroup) this._gridGroup.visible = visible;
    if (this._axesHelper) this._axesHelper.visible = visible;
    this._needsRender = true;
  }

  // ─── 4.5 涂色网格显示开关 ──────────────────────────────────

  /**
   * @param {boolean} visible
   */
  setPaintingVisible(visible) {
    this._paintingVisible = visible;
    for (const m of this._paintingMeshes) m.visible = visible;
    this._needsRender = true;
  }

  // ─── 5. 旋转开关 ──────────────────────────────────────────

  /**
   * @param {boolean} enabled
   */
  setRotationEnabled(enabled) {
    this._shellRotationEnabled = enabled;
    this._needsRender = true;
  }

  // ─── 6. 转速修改 ──────────────────────────────────────────

  /**
   * @param {number} speed  建议 0.01（慢）/ 0.05（中）/ 0.20（快）
   */
  setRotationSpeed(speed) {
    this._shellSpeed = speed;
  }

  // ─── 7. 更新恒星颜色 ───────────────────────────────────────

  /**
   * 根据光度系数更新恒星颜色
   * @param {number} luminosity  0.1 ~ 10
   */
  setSunColor(luminosity) {
    const lum = Math.max(0.01, Math.min(10, luminosity));
    const { back, core } = getStarColors(lum);

    if (this._originSphere) this._originSphere.material.color.copy(new THREE.Color(core));
    if (this._starGlowInner) this._starGlowInner.material.color.copy(new THREE.Color(core));
    this._sharedBackMaterial.color.copy(new THREE.Color(back));
    this._needsRender = true;
  }

  // ─── 辅助 ──────────────────────────────────────────────────

  /** 返回当前场景中的壳层可见性映射 */
  getLayerVisibility() {
    const result = {};
    for (const [key, obj] of this._visObjects) {
      if (!key.startsWith('cloud_glow_')) result[key] = obj.visible;
    }
    return result;
  }

  /** 返回当前缩放系数 */
  getScale() { return this._currentScale; }

  /**
   * 清空场景中的所有 3D 对象（壳层、云轨道、节点等）
   */
  clearScene() {
    this._shellGroups.length = 0;
    this._paintingMeshes.length = 0;
    this._visObjects.clear();
    if (!this._rootGroup) return;
    // 递归释放所有子对象的几何体与材质
    this._rootGroup.traverse((obj) => {
      // 共享的节点球体几何与壳面背面材质由类持有，不可释放
      if (obj.geometry && obj.geometry !== this._nodeGeom) obj.geometry.dispose();
      if (obj.material && obj.material !== this._sharedBackMaterial) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) m.dispose();
      }
    });
    this._rootGroup.remove(...this._rootGroup.children);
    this._needsRender = true;
  }

  // ─── 生命周期 ──────────────────────────────────────────────

  resize() {
    if (!this._canvas || !this._renderer || !this._camera) return;
    const w = this._canvas.clientWidth, h = this._canvas.clientHeight;
    if (this._canvas.width !== w || this._canvas.height !== h) {
      this._renderer.setSize(w, h, false);
    }
    this._camera.aspect = w / h;
    this._camera.updateProjectionMatrix();
  }

  dispose() {
    if (this._animFrameId !== null) {
      cancelAnimationFrame(this._animFrameId);
      this._animFrameId = null;
    }
    if (this._resizeObserver) { this._resizeObserver.disconnect(); this._resizeObserver = null; }
    window.removeEventListener('blur', this._onBlur);
    this.clearScene();
    if (this._sharedBackMaterial) { this._sharedBackMaterial.dispose(); this._sharedBackMaterial = null; }
    if (this._renderer) { this._renderer.dispose(); this._renderer = null; }
    if (this._controls) { this._controls.dispose(); this._controls = null; }
    if (this._nodeGeom) { this._nodeGeom.dispose(); this._nodeGeom = null; }
  }

  // ═══════════════════════════════════════════════════════════
  // 内部实现
  // ═══════════════════════════════════════════════════════════

  _startLoop() {
    const loop = () => {
      this._animFrameId = requestAnimationFrame(loop);
      const dt = Math.min(this._clock.getDelta(), 0.1);
      if (this._shellRotationEnabled) {
        this._needsRender = true; // 旋转中持续渲染
        const maxR = this._currentScale > 0 ? 1 / this._currentScale : 1;
        for (const sg of this._shellGroups) {
          const omega = this._shellSpeed * maxR / sg.radius;
          const rot = new THREE.Quaternion().setFromAxisAngle(sg.pole, omega * dt);
          sg.group.quaternion.premultiply(rot);
        }
      }
      this._controls.update(); // 处理阻尼惯性（change 事件会置脏）
      // 静止且无交互/变化时跳过渲染（省电）
      if (this._needsRender) {
        this.resize();
        this._renderer.render(this._scene, this._camera);
        this._needsRender = false;
      }
    };
    this._animFrameId = requestAnimationFrame(loop);
  }

  _createLongitudeGrid(radius) {
    if (!this._gridGroup) return;
    while (this._gridGroup.children.length) {
      const c = this._gridGroup.children[0];
      this._gridGroup.remove(c);
      if (c.geometry) c.geometry.dispose();
      if (c.material) c.material.dispose();
    }
    const tick = radius * 0.05, midTick = radius * 0.04, minorTick = radius * 0.03;
    const fontSize = radius * 0.04;

    // 刻度标签图集: 36 个 64×32 格（12 列 × 3 行）绘制到一张 canvas，
    const CELL_W = 64, CELL_H = 32, COLS = 12, ROWS = 3;
    const atlas = document.createElement('canvas');
    atlas.width = CELL_W * COLS;
    atlas.height = CELL_H * ROWS;
    const actx = atlas.getContext('2d');
    actx.fillStyle = '#ffdd99';
    actx.font = 'bold 20px sans-serif';
    actx.textAlign = 'center';
    actx.textBaseline = 'middle';
    for (let k = 0; k < 36; k++) {
      const cx = (k % COLS) * CELL_W, cy = Math.floor(k / COLS) * CELL_H;
      actx.fillText(String(k * 10), cx + CELL_W / 2, cy + CELL_H / 2 + 1);
    }
    const labelTex = new THREE.CanvasTexture(atlas);
    labelTex.minFilter = THREE.LinearFilter;
    // 双面显示
    const labelMat = new THREE.MeshBasicMaterial({ map: labelTex, transparent: true, depthWrite: false, side: THREE.DoubleSide });

    for (let deg = 0; deg < 360; deg++) {
      const rad = THREE.MathUtils.degToRad(deg + 180);
      const dir = new THREE.Vector3(Math.sin(rad), 0, Math.cos(rad));
      if (deg % 10 === 0) {
        const s = dir.clone().multiplyScalar(radius);
        const e = dir.clone().multiplyScalar(radius + tick);
        this._gridGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([s, e]), new THREE.LineBasicMaterial({ color: 0xffdd99 })));
        // 标签公告板平面（Sprite 共享内部几何无法按实例设 UV，改用平面 + 图集 UV）
        const k = deg / 10;
        const u0 = (k % COLS) / COLS, u1 = u0 + 1 / COLS;
        const r = Math.floor(k / COLS);
        const v0 = 1 - (r + 1) / ROWS, v1 = 1 - r / ROWS; // CanvasTexture flipY: v=1 为画布顶部
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.Float32BufferAttribute([
          -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
        ], 3));
        geom.setAttribute('uv', new THREE.Float32BufferAttribute([
          u0, v0, u1, v0, u1, v1, u0, v1,
        ], 2));
        geom.setIndex([0, 1, 2, 0, 2, 3]);
        const mesh = new THREE.Mesh(geom, labelMat);
        mesh.position.copy(dir.clone().multiplyScalar(radius + tick * 1.35));
        mesh.scale.set(fontSize * 2, fontSize, 1);
        // 渲染在涂色层(renderOrder=3)之上（renderOrder 必须设在对象上，材质上的设置无效）；
        // 深度测试保留，被球体遮挡时依旧隐藏
        mesh.renderOrder = 4;
        // 平铺在黄道平面上: 文字方向垂直于刻度线（沿切向），数字底部朝向内侧，法线朝上
        const up = new THREE.Vector3(0, 1, 0);
        const basis = new THREE.Matrix4().makeBasis(
          new THREE.Vector3().crossVectors(dir, up),  // X: 文字方向 = 切线（垂直于刻度线）
          dir.clone(),                                 // Y: 字顶朝外（数字底部朝向内侧）
          up,                                          // Z: 平面法线朝上
        );
        mesh.quaternion.setFromRotationMatrix(basis);
        this._gridGroup.add(mesh);
      } else if (deg % 5 === 0) {
        const s = dir.clone().multiplyScalar(radius);
        const e = dir.clone().multiplyScalar(radius + midTick);
        this._gridGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([s, e]), new THREE.LineBasicMaterial({ color: 0xaabbcc })));
      } else {
        const s = dir.clone().multiplyScalar(radius);
        const e = dir.clone().multiplyScalar(radius + minorTick);
        this._gridGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([s, e]), new THREE.LineBasicMaterial({ color: 0x8899bb })));
      }
    }
    const ringPts = [];
    for (let i = 0; i <= 128; i++) {
      const a = (i / 128) * Math.PI * 2;
      ringPts.push(new THREE.Vector3(Math.sin(a) * radius, 0, Math.cos(a) * radius));
    }
    this._gridGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(ringPts), new THREE.LineBasicMaterial({ color: 0x556688 })));
  }

}

export { DysonSpherePreview, STAR_TYPE_COLORS, getStarColors };
