/**
 * shellLayerCompute — 整层戴森壳的纯几何计算（节点 / 框架 / 细胞 / 涂色网格）
 */
import * as THREE from 'three';
import {
  _toHexColor, _convertBP, _normQuat, _edgeKey,
  _sphericalArcPoints, _gridArcPoints,
} from './geometry.js';
import { computeShellCellBuckets } from './shellCellsCompute.js';
import { buildPaintingGeometry } from './paintingGrid.js';

// 框架杆件尺寸（蓝图单位）: 切向宽度 / 径向厚度
const FRAME_BAR_WIDTH = 30;
const FRAME_BAR_THICKNESS = 20;

// 同一十六进制色只创建一个 THREE.Color
function makeHexColorCache() {
  const cache = new Map();
  return (hex) => {
    let c = cache.get(hex);
    if (!c) { c = new THREE.Color(hex); cache.set(hex, c); }
    return c;
  };
}

/**
 * 节点: id、位置（已缩放、已按轨道姿态旋转）与颜色
 * @returns {{ids: Uint32Array, positions: Float32Array, colors: Uint32Array, count: number}}
 */
export function computeNodes(shData, orbit, scale) {
  const renderR = orbit.radius;
  const shQuat = _normQuat(orbit);
  const ids = [];
  const positions = [];
  const colors = [];
  if (shData.nodes) {
    for (let ni = 1; ni < shData.nodes.length; ni++) {
      const nd = shData.nodes[ni];
      if (!nd) continue;
      const d = new THREE.Vector3(nd.coordinate.x, nd.coordinate.y, nd.coordinate.z).normalize();
      d.applyQuaternion(shQuat);
      const pos = _convertBP(d).multiplyScalar(renderR * scale);
      ids.push(nd.id);
      positions.push(pos.x, pos.y, pos.z);
      colors.push(_toHexColor(nd.color, 0x60D6FD));
    }
  }
  return {
    ids: new Uint32Array(ids),
    positions: new Float32Array(positions),
    colors: new Uint32Array(colors),
    count: colors.length,
  };
}

/**
 * 框架杆件: 顶点、颜色、两组索引（外侧面 / 径向内侧面）与边类型表
 * @param {Map<number, THREE.Vector3>} nodeMap
 * @returns {{positions: Float32Array, colors: Float32Array, indices: Uint32Array,
 *   backIndices: Uint32Array, edgeTypes: Array<[string, number]>}}
 */
export function computeFrames(shData, nodeMap, shPole, scale) {
  const ftMap = new Map();
  const hexColor = makeHexColorCache();
  const barVerts = [];
  const barCols = [];
  const barIdx = [];        // 外侧面 + 两个切向侧面（用框架自身的颜色）
  const barBackIdx = [];    // 径向内侧面（朝球心，用恒星色）

  const halfW = (FRAME_BAR_WIDTH / 2) * scale;
  const halfT = (FRAME_BAR_THICKNESS / 2) * scale;
  const tv = new THREE.Vector3();
  const buildBar = (pts, color) => {
    const n = pts.length;
    if (n < 2) return;
    const base = barVerts.length / 3;
    let prevT = null;
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      const t = tv.subVectors(b, a);
      if (t.lengthSq() < 1e-12) {
        if (prevT) t.copy(prevT); else t.set(0, 1, 0);
      } else {
        t.normalize();
        if (!prevT) prevT = t.clone();
        else prevT.copy(t);
      }
      const rad = pts[i].clone().normalize();
      const u = new THREE.Vector3().crossVectors(t, rad);
      const bx = pts[i].x - rad.x * halfT, by = pts[i].y - rad.y * halfT, bz = pts[i].z - rad.z * halfT;
      const tx = pts[i].x + rad.x * halfT, ty = pts[i].y + rad.y * halfT, tz = pts[i].z + rad.z * halfT;
      const ux = u.x * halfW, uy = u.y * halfW, uz = u.z * halfW;
      // 断面 4 点: 0/1 = 底部±u（径向内侧）, 2/3 = 顶部±u（径向外侧）
      barVerts.push(bx + ux, by + uy, bz + uz);
      barVerts.push(bx - ux, by - uy, bz - uz);
      barVerts.push(tx + ux, ty + uy, tz + uz);
      barVerts.push(tx - ux, ty - uy, tz - uz);
      barCols.push(color.r, color.g, color.b, color.r, color.g, color.b, color.r, color.g, color.b, color.r, color.g, color.b);
    }
    for (let i = 0; i < n - 1; i++) {
      const bi = base + i * 4, bj = bi + 4;
      // 径向外侧面（顶面）
      barIdx.push(bi + 3, bi + 2, bj + 2, bi + 3, bj + 2, bj + 3);
      // 径向内侧面（底面）单独一组: 从壳体内侧看到的就是它，用恒星色
      barBackIdx.push(bi + 0, bi + 1, bj + 1, bi + 0, bj + 1, bj + 0);
      // 两个切向侧面
      barIdx.push(
        bi + 0, bj + 0, bj + 2, bi + 0, bj + 2, bi + 2,
        bi + 1, bi + 3, bj + 3, bi + 1, bj + 3, bj + 1,
      );
    }
  };
  const re = (id1, id2, color, type = 0) => {
    const k = _edgeKey(id1, id2);
    if (ftMap.has(k)) return;
    ftMap.set(k, type);
    const f = nodeMap.get(id1), t = nodeMap.get(id2);
    if (!f || !t) return;
    const pts = (type === 1 && shPole) ? _gridArcPoints(f, t, 18, shPole) : _sphericalArcPoints(f, t, 18);
    buildBar(pts, hexColor(color));
  };
  if (shData.frames) {
    shData.frames.forEach(fr => {
      if (!fr) return;
      re(fr.relation[0], fr.relation[1], _toHexColor(fr.color, 0x175473), fr.type);
    });
  }
  return {
    positions: new Float32Array(barVerts),
    colors: new Float32Array(barCols),
    indices: new Uint32Array(barIdx),
    backIndices: new Uint32Array(barBackIdx),
    edgeTypes: [...ftMap],
  };
}

/**
 * 涂色网格: 顶点按轨道姿态旋转并缩放到轨道半径（纯数据，材质留主线程建）
 * @returns {Array<{positions: Float32Array, colors: Float32Array, additive: boolean}>|null}
 */
export function computePainting(shData, orbit, scale) {
  const parts = buildPaintingGeometry(shData.fillGrid);
  if (!parts) return null;
  const renderR = orbit.radius;
  const shQuat = _normQuat(orbit);
  const paintR = renderR * scale;
  const qx = shQuat.x, qy = shQuat.y, qz = shQuat.z, qw = shQuat.w;
  return parts.map((part) => {
    const src = part.positions;
    const out = new Float32Array(src.length);
    for (let vi = 0; vi < src.length; vi += 3) {
      const x = src[vi], y = src[vi + 1], z = src[vi + 2];
      const tx = 2 * (qy * z - qz * y);
      const ty = 2 * (qz * x - qx * z);
      const tz = 2 * (qx * y - qy * x);
      const rx = x + qw * tx + (qy * tz - qz * ty);
      const ry = y + qw * ty + (qz * tx - qx * tz);
      const rz = z + qw * tz + (qx * ty - qy * tx);
      out[vi] = rx * paintR;
      out[vi + 1] = ry * paintR;
      out[vi + 2] = -rz * paintR;
    }
    return { positions: out, colors: part.colors, additive: !!part.additive };
  });
}

/**
 * 整层几何: 节点 → 框架 → 细胞 → 涂色（不计时，时限由主线程看门狗负责）
 * @param {object} shData  壳层数据
 * @param {object} orbit   轨道（radius + 姿态）
 * @param {number} scale   缩放系数
 * @returns {{nodes: object, frames: object, cells: Array|null, painting: Array|null, pole: {x:number,y:number,z:number}}}
 */
export function computeLayerGeometry(shData, orbit, scale) {
  const shQuat = _normQuat(orbit);
  const poleRaw = new THREE.Vector3(0, 1, 0); poleRaw.applyQuaternion(shQuat);
  const shPole = _convertBP(poleRaw);

  const nodes = computeNodes(shData, orbit, scale);

  // 节点位置表（框架与细胞都要用；键是节点 id，面的 relation 里存的就是 id）
  const nodeMap = new Map();
  for (let i = 0; i < nodes.count; i++) {
    nodeMap.set(nodes.ids[i], new THREE.Vector3(
      nodes.positions[i * 3], nodes.positions[i * 3 + 1], nodes.positions[i * 3 + 2]));
  }

  const frames = computeFrames(shData, nodeMap, shPole, scale);
  const cells = computeShellCellBuckets(
    shData, nodeMap, shPole, new Map(frames.edgeTypes), orbit, scale);
  const painting = computePainting(shData, orbit, scale);

  return { nodes, frames, cells, painting, pole: { x: shPole.x, y: shPole.y, z: shPole.z } };
}
