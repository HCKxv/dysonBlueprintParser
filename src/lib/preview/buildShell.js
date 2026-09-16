/** 戴森壳层渲染对象构建：节点、框架、细胞板、涂色（涂色烘成立方体贴图，见 bakeShellPainting）。 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildPainting } from './paintingGrid.js';
import { buildShellCells, getShellCellGridScale } from './buildShellCells.js';
import { applyShellPattern } from './shellPattern.js';
import {
  _toHexColor, _convertBP, _normQuat, _edgeKey,
  _sphericalArcPoints, _gridArcPoints,
} from './geometry.js';

const STENCIL_BASE = 200; // 每层模板值 = layerId + 200

const FRAME_BAR_WIDTH = 30;      // 切向宽度（蓝图单位）
const FRAME_BAR_THICKNESS = 20;  // 径向厚度

// 节点（简化模型）: 主体圆柱 + 朝内的细圆柱 + 朝外发光端面（节点颜色）
const NODE_BODY_RADIUS = 36;     // 主体圆柱半径（蓝图单位）
const NODE_BODY_HEIGHT = 46;     // 主体圆柱高度（沿径向）
const NODE_CAP_RADIUS = 20;      // 朝外发光圆片半径（比主体小一圈）
const NODE_STALK_RADIUS = 7;     // 细圆柱半径
const NODE_STALK_LENGTH = 108;    // 细圆柱长度（朝内伸出）

/**
 * 构建节点的两套几何（蓝图单位，轴沿 +Y = 径向外）:
 *   body —— 主体圆柱 + 朝内的细圆柱（用节点颜色、受光）
 *   cap  —— 朝外端面（发光，用节点颜色）
 * 真实模型由 buildShellLayer 用每实例的旋转把 +Y 对齐到各自节点的径向。
 */
export function buildNodeGeometries() {
  const yAxis = new THREE.Vector3(0, 1, 0);
  // 主体: 中心在原点，沿 Y 从 -H/2 到 +H/2
  const body = new THREE.CylinderGeometry(NODE_BODY_RADIUS, NODE_BODY_RADIUS, NODE_BODY_HEIGHT, 14, 1, false);
  // 细圆柱: 从主体底面朝内（-Y）伸出去
  const stalk = new THREE.CylinderGeometry(NODE_STALK_RADIUS, NODE_STALK_RADIUS, NODE_STALK_LENGTH, 8, 1, false);
  stalk.translate(0, -(NODE_BODY_HEIGHT + NODE_STALK_LENGTH) / 2, 0);
  const merged = mergeGeometries([body, stalk], false) ?? body;
  merged.computeVertexNormals();
  // 端面: 朝外那面（+Y），朝外发光
  const cap = new THREE.CircleGeometry(NODE_CAP_RADIUS, 14);
  cap.rotateX(-Math.PI / 2);                       // 圆面法线 → +Y
  cap.translate(0, NODE_BODY_HEIGHT / 2 + 0.35, 0); // 贴在主体顶面外一点，避免 z-fighting
  return { body: merged, cap, yAxis };
}

// 同一十六进制色只创建一个 THREE.Color
function makeHexColorCache() {
  const cache = new Map();
  return (hex) => {
    let c = cache.get(hex);
    if (!c) { c = new THREE.Color(hex); cache.set(hex, c); }
    return c;
  };
}

function buildNodes(nodeData, shellGroup, nodeGeoms, scale) {
  if (!nodeData.length || !nodeGeoms) return;
  const { body, cap, yAxis } = nodeGeoms;
  // 双面: 从壳体内侧看节点时，圆柱的内表面同样要挡住后面的端面
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x4a4f55, metalness: 0.25, roughness: 0.6, side: THREE.DoubleSide,   // 深灰
  });
  // 端面发光: 用 Basic + 实例色（实例色会乘进材质色），不受光照衰减
  const capMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  const bodyInst = new THREE.InstancedMesh(body, bodyMat, nodeData.length);
  const capInst = new THREE.InstancedMesh(cap, capMat, nodeData.length);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const dir = new THREE.Vector3();
  const sc = new THREE.Vector3(scale, scale, scale);
  const c = new THREE.Color();
  nodeData.forEach((nd, i) => {
    // 让几何的 +Y 对齐该节点的径向（朝外），于是细圆柱自动朝太阳
    dir.copy(nd.pos).normalize();
    q.setFromUnitVectors(yAxis, dir);
    m4.compose(nd.pos, q, sc);
    bodyInst.setMatrixAt(i, m4);
    capInst.setMatrixAt(i, m4);
    // 只有朝外端面用节点颜色（发光）；主体保持材质本色（金属灰），与框架一致
    c.setHex(nd.color);
    capInst.setColorAt(i, c);
  });
  for (const inst of [bodyInst, capInst]) {
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    inst.frustumCulled = false;
    shellGroup.add(inst);
  }
}

// 框架杆件；ftMap: 边键 → 框架类型
function buildFrames(shData, nodeMap, shPole, shellGroup, scale, sharedBackMaterial) {
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
  if (barVerts.length) {
    const posAttr = new THREE.Float32BufferAttribute(barVerts, 3);
    const colAttr = new THREE.Float32BufferAttribute(barCols, 3);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', posAttr);
    geom.setAttribute('color', colAttr);
    geom.setIndex(barIdx);
    geom.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.2, roughness: 0.6 });
    shellGroup.add(new THREE.Mesh(geom, mat));

    // 径向内侧面: 从壳体内侧看到的就是这一组面，用恒星色（与细胞背板同一套配色）
    const backGeom = new THREE.BufferGeometry();
    backGeom.setAttribute('position', posAttr);
    backGeom.setAttribute('color', colAttr);
    backGeom.setIndex(barBackIdx);
    backGeom.computeVertexNormals();
    let backMat;
    if (sharedBackMaterial) {
      // 与细胞背板同源: 克隆那份恒星色材质，改成双面（内侧面的朝向随弧线变化）
      backMat = sharedBackMaterial.clone();
      backMat.side = THREE.DoubleSide;
      backMat.color.copy(sharedBackMaterial.color);
      backMat.vertexColors = false;   // 用材质的恒星色，不用框架自身的顶点色
    } else {
      backMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    }
    const backMesh = new THREE.Mesh(backGeom, backMat);
    backMesh.name = 'shellFrameBack';
    // 标记来源，preview.js 的 setSunColor 会顺着它一起换色
    backMesh.userData.shellSharedBack = sharedBackMaterial || null;
    shellGroup.add(backMesh);
  }
  return ftMap;
}



/**
 * 构建一个壳层的全部渲染对象（节点、框架、细胞板、背面图案层、涂色烘焙源）。
 *
 * @param {object} shData               壳层数据（nodes / frames / faces / fillGrid）
 * @param {object} orbit                轨道对象，取 radius 与姿态四元数
 * @param {number} scale                缩放系数（= 1 / 最大轨道半径）
 * @param {{body: THREE.BufferGeometry, cap: THREE.BufferGeometry}} nodeGeoms  共享的节点几何
 * @param {THREE.Material} sharedBackMaterial  恒星色背板材质（背面与框架内侧面共用配色）
 * @returns {{group: THREE.Group, pole: THREE.Vector3, cells: THREE.Group|null, paintingGroup: THREE.Group}}
 *          group 为整层（含背面），cells 仅正面细胞，paintingGroup 为涂色烘焙源
 */
export function buildShellLayer(shData, orbit, scale, nodeGeoms, sharedBackMaterial) {
  const renderR = orbit.radius;
  const shQuat = _normQuat(orbit);
  const poleRaw = new THREE.Vector3(0, 1, 0); poleRaw.applyQuaternion(shQuat);
  const shPole = _convertBP(poleRaw);
  const shellGroup = new THREE.Group();
  const stencilRef = STENCIL_BASE + (orbit.id || 0);

  const nodeMap = new Map();
  const nodeData = [];
  if (shData.nodes) {
    for (let ni = 1; ni < shData.nodes.length; ni++) {
      const nd = shData.nodes[ni];
      if (!nd) continue;
      const d = new THREE.Vector3(nd.coordinate.x, nd.coordinate.y, nd.coordinate.z).normalize();
      d.applyQuaternion(shQuat);
      const pos = _convertBP(d).multiplyScalar(renderR * scale);
      nodeMap.set(nd.id, pos);
      nodeData.push({ pos, color: _toHexColor(nd.color, 0x60D6FD) });
    }
  }

  buildNodes(nodeData, shellGroup, nodeGeoms, scale);
  const ftMap = buildFrames(shData, nodeMap, shPole, shellGroup, scale, sharedBackMaterial);
  const cellMesh = buildShellCells(shData, nodeMap, shPole, ftMap, orbit, scale, stencilRef);
  if (cellMesh) {
    // cellMesh 是按图案分组的 Group（每种图案一套图案贴图材质）
    shellGroup.add(cellMesh);
    if (sharedBackMaterial) {
      // 背面按图案克隆材质并挂图案补丁（几何共用），从缝隙/内侧看也有图案
      const gridScale = getShellCellGridScale(orbit.radius);
      cellMesh.children.forEach((cell, i) => {
        const pattern = cell.userData.shellPattern ?? 0;
        const backMat = sharedBackMaterial.clone();
        backMat.color.copy(sharedBackMaterial.color);
        applyShellPattern(backMat, { pattern, gridScale, useFine: false });   // 背面只画图案，不画细胞点细网
        const backCells = new THREE.Mesh(cell.geometry, backMat);
        backCells.name = `shellBackCells${i ? ':' + i : ''}`;
        backCells.userData.shellBackPattern = pattern;
        backCells.userData.shellSharedBack = sharedBackMaterial;
        backCells.frustumCulled = false;
        shellGroup.add(backCells);
      });
    }
  }
  // 涂色（A+）: 生成临时网格组，交给 preview 烘成立方体贴图后挂到细胞材质上
  const paintingGroup = buildPainting(shData, shQuat, renderR, scale);

  return {
    group: shellGroup,
    pole: shPole.clone().normalize(),
    cells: cellMesh,
    paintingGroup,
  };
}
