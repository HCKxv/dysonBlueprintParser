/**
 * DysonSpherePreview — 戴森球蓝图 3D 预览模块
 *
 *
 * ── 对外接口 ────────────────────────────────────────────────
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
 *   其中 color = { r,g,b,a } | { h,s,v,a }
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

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

function _createLineSegment(from, to, color = 0xffffff, type = 0, pole = null) {
  const pts = (type === 1 && pole) ? _gridArcPoints(from, to, 18, pole) : _sphericalArcPoints(from, to, 18);
  const geom = new THREE.BufferGeometry().setFromPoints(pts);
  const mat = new THREE.LineBasicMaterial({ color });
  return new THREE.Line(geom, mat);
}

function _createFaceMesh(points, color = 0x00b7ff, opacity = 0.25, pole = null, edgeTypes = null) {
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
    return _createFaceMesh(refined, color, opacity, pole, null);
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
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color, opacity, transparent: opacity < 1, side: THREE.DoubleSide, depthWrite: true });
  return new THREE.Mesh(geom, mat);
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
    this._pointLight = null;
    this._originSphere = null;
    this._starGlowInner = null;

    this._shellGroups = [];
    this._shellRotationEnabled = true;
    this._shellSpeed = 0.05;
    this._currentScale = 1;
    this._clock = new THREE.Clock();
    this._animFrameId = null;

    this._visObjects = new Map();
    this._nodeGeom = new THREE.SphereGeometry(1, 8, 8);

    // 绑定的事件回调引用，用于 dispose
    this._onResize = null;
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

    // 指针丢失兜底
    canvas.addEventListener('lostpointercapture', (e) => {
      canvas.dispatchEvent(new PointerEvent('pointerup', { pointerId: e.pointerId }));
    });
    this._onBlur = () => {
      for (let i = 0; i < 10; i++) canvas.dispatchEvent(new PointerEvent('pointerup', { pointerId: i }));
    };
    window.addEventListener('blur', this._onBlur);

    // resize
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);

    // 灯光
    this._pointLight = new THREE.PointLight(0xffdd55, 1.2, 0, 0);
    this._pointLight.position.set(0, 0, 0);
    this._scene.add(this._pointLight);
    this._scene.add(new THREE.AmbientLight(0xffffff, 1.2));

    // 根组
    this._rootGroup = new THREE.Group();
    this._scene.add(this._rootGroup);

    // 刻度网格
    this._gridGroup = new THREE.Group();
    this._gridGroup.name = 'longitudeGrid';
    this._scene.add(this._gridGroup);

    // 坐标轴
    this._axesHelper = new THREE.AxesHelper(0.05);
    this._axesHelper.material.depthTest = false;
    this._axesHelper.renderOrder = 2;
    this._scene.add(this._axesHelper);

    this._createLongitudeGrid(1.2);

    // 恒星
    this._originSphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 48, 24),
      new THREE.MeshBasicMaterial({ color: 0xffdd55 })
    );
    this._scene.add(this._originSphere);

    // 光晕
    this._starGlowInner = new THREE.Mesh(
      new THREE.SphereGeometry(0.068, 32, 16),
      new THREE.MeshBasicMaterial({ color: 0xffdd55, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false })
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

        const nodeMap = new Map();
        if (shData.nodes) {
          for (let ni = 1; ni < shData.nodes.length; ni++) {
            const nd = shData.nodes[ni];
            if (!nd) continue;
            const d = new THREE.Vector3(nd.coordinate.x, nd.coordinate.y, nd.coordinate.z).normalize();
            d.applyQuaternion(shQuat);
            const pos = _convertBP(d).multiplyScalar(renderR * this._currentScale);
            nodeMap.set(nd.id, pos);
            shellGroup.add(this._createNode(pos, nd.id, _toHexColor(nd.color, 0x60D6FD)));
          }
        }

        const renderedEdges = new Set();
        const ftMap = new Map();
        const re = (id1, id2, color, type = 0) => {
          const k = _edgeKey(id1, id2);
          if (renderedEdges.has(k)) return;
          renderedEdges.add(k);
          const f = nodeMap.get(id1), t = nodeMap.get(id2);
          if (f && t) shellGroup.add(_createLineSegment(f, t, color, type, shPole));
        };
        if (shData.frames) {
          shData.frames.forEach(fr => {
            if (!fr) return;
            const k = _edgeKey(fr.structureRelation[0], fr.structureRelation[1]);
            ftMap.set(k, fr.type);
            re(fr.structureRelation[0], fr.structureRelation[1], _toHexColor(fr.color, 0x175473), fr.type);
          });
        }
        if (shData.faces) {
          shData.faces.forEach(fc => {
            if (!fc || !Array.isArray(fc.relation) || fc.relation.length < 3) return;
            if (fc.relation.some(nid => !nodeMap.has(nid))) return;
            const rel = fc.relation.slice();
            const pts = rel.map(nid => nodeMap.get(nid));
            if (pts.some(p => !p)) return;
            const edgeTypes = rel.map((_, j) => ftMap.get(_edgeKey(rel[j], rel[(j + 1) % rel.length])) ?? 0);
            const m = _createFaceMesh(pts, _toHexColor(fc.color, 0x175473), 1, shPole, edgeTypes);
            if (m) shellGroup.add(m);
          });
        }

        shellGroup.visible = gv;
        this._visObjects.set('shell_' + orbit.id, shellGroup);
        this._rootGroup.add(shellGroup);
      }
    }

    this._camera.position.set(0, 1.8, -3.2);
    this._controls.target.set(0, 0, 0);
    this._controls.update();
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
  }

  // ─── 4. 刻度显示开关 ───────────────────────────────────────

  /**
   * @param {boolean} visible
   */
  setGridVisible(visible) {
    if (this._gridGroup) this._gridGroup.visible = visible;
    if (this._axesHelper) this._axesHelper.visible = visible;
  }

  // ─── 5. 旋转开关 ──────────────────────────────────────────

  /**
   * @param {boolean} enabled
   */
  setRotationEnabled(enabled) {
    this._shellRotationEnabled = enabled;
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
    let color;
    if (lum <= 0.8) color = new THREE.Color(0xff8855);
    else if (lum < 1.3) color = new THREE.Color(0xffdd55);
    else if (lum < 1.8) color = new THREE.Color(0xf0f4ff);
    else color = new THREE.Color(0x5588ff);
    if (this._pointLight) this._pointLight.color.copy(color);
    if (this._originSphere) this._originSphere.material.color.copy(color);
    if (this._starGlowInner) this._starGlowInner.material.color.copy(color);
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
    this._visObjects.clear();
    if (!this._rootGroup) return;
    while (this._rootGroup.children.length) {
      const c = this._rootGroup.children[0];
      this._rootGroup.remove(c);
      if (c.geometry && c.geometry !== this._nodeGeom) c.geometry.dispose();
      if (c.material) {
        const mats = Array.isArray(c.material) ? c.material : [c.material];
        for (const m of mats) m.dispose();
      }
    }
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
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('blur', this._onBlur);
    this.clearScene();
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
      this.resize();
      const dt = Math.min(this._clock.getDelta(), 0.1);
      if (this._shellRotationEnabled) {
        const maxR = this._currentScale > 0 ? 1 / this._currentScale : 1;
        for (const sg of this._shellGroups) {
          const omega = this._shellSpeed * maxR / sg.radius;
          const rot = new THREE.Quaternion().setFromAxisAngle(sg.pole, omega * dt);
          sg.group.quaternion.premultiply(rot);
        }
      }
      this._controls.update();
      this._renderer.render(this._scene, this._camera);
    };
    this._animFrameId = requestAnimationFrame(loop);
  }

  _createNode(position, id, color = 0x44ffb8) {
    const mat = new THREE.MeshStandardMaterial({ color, emissive: 0x0a2f20, metalness: 0.2, roughness: 0.6 });
    const sphere = new THREE.Mesh(this._nodeGeom, mat);
    sphere.position.copy(position);
    sphere.scale.setScalar(50 * this._currentScale);
    sphere.name = 'node-' + id;
    return sphere;
  }

  _createLongitudeGrid(radius) {
    if (!this._gridGroup) return;
    while (this._gridGroup.children.length) {
      const c = this._gridGroup.children[0];
      this._gridGroup.remove(c);
      if (c.geometry) c.geometry.dispose();
      if (c.material) c.material.dispose();
    }
    const tick = radius * 0.08, midTick = radius * 0.05, minorTick = radius * 0.03;
    const fontSize = radius * 0.04;
    for (let deg = 0; deg < 360; deg++) {
      const rad = THREE.MathUtils.degToRad(deg + 180);
      const dir = new THREE.Vector3(Math.sin(rad), 0, Math.cos(rad));
      if (deg % 10 === 0) {
        const s = dir.clone().multiplyScalar(radius);
        const e = dir.clone().multiplyScalar(radius + tick);
        this._gridGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([s, e]), new THREE.LineBasicMaterial({ color: 0xffdd99 })));
        const lc = document.createElement('canvas'); lc.width = 64; lc.height = 32;
        const ctx = lc.getContext('2d');
        ctx.fillStyle = '#ffdd99'; ctx.font = 'bold 20px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(`${deg}°`, 32, 24);
        const tex = new THREE.CanvasTexture(lc); tex.minFilter = THREE.LinearFilter;
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
        sp.position.copy(dir.clone().multiplyScalar(radius + tick * 1.8));
        sp.scale.set(fontSize * 2, fontSize, 1);
        this._gridGroup.add(sp);
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

export { DysonSpherePreview };
