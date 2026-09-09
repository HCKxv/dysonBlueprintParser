/**
 * 戴森壳层渲染对象构建
 *
 * @param {object} shData           - shell.shells[orbit.id]（nodes/frames/faces/fillGrid）
 * @param {object} orbit            - orbitList 项（id/radius/四元数）
 * @param {number} scale            - 缩放系数
 * @param {SphereGeometry} nodeGeom - 共享节点球体几何
 * @param {Material} sharedBackMaterial - 共享壳面背面材质
 * @returns {{
 *   group: THREE.Group,        // 壳层根组
 *   pole: THREE.Vector3,       // 自转轴
 *   paintingMeshes: Array,     // 涂色网格列表
 * }}
 */
import * as THREE from 'three';
import { buildPaintingGeometry } from './paintingGrid.js';
import {
  _toHexColor, _convertBP, _normQuat, _edgeKey,
  _sphericalArcPoints, _gridArcPoints, _buildFaceGeometry,
} from './geometry.js';

// 涂色裁剪模板值基准: 每层壳面写入自己层的值、该层涂色只测试自己层的值
// （与游戏一致: 壳面写 _Stencil = layerId+200，涂色层测试同值；跨层叠加靠深度缓冲遮挡）
const STENCIL_BASE = 200;

// 框架杆件尺寸（蓝图单位，节点球体半径为 50）
// 杆件为扁长方形管体: 宽面贴壳面（切向）
const FRAME_BAR_WIDTH = 30;      // 切向宽度
const FRAME_BAR_THICKNESS = 20;  // 径向厚度

// 颜色缓存工厂: 同一层内重复的十六进制色共用同一个 THREE.Color 实例
function makeHexColorCache() {
  const cache = new Map();
  return (hex) => {
    let c = cache.get(hex);
    if (!c) { c = new THREE.Color(hex); cache.set(hex, c); }
    return c;
  };
}

// ─── 节点: InstancedMesh 合并为一次绘制 ──────────────────────
function buildNodes(nodeData, shellGroup, nodeGeom, scale) {
  if (!nodeData.length) return;
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.2, roughness: 0.6 });
  const inst = new THREE.InstancedMesh(nodeGeom, mat, nodeData.length);
  const m4 = new THREE.Matrix4();
  const c = new THREE.Color();
  const s = 50 * scale;
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

// ─── 框架: 沿弧线挤出扁长方形管体并合并为共享几何（顶点色）─────
// 返回 ftMap: 边键 → 框架类型（0=测地线 1=经纬线），供壳面细分复用
function buildFrames(shData, nodeMap, shPole, shellGroup, scale) {
  const ftMap = new Map();
  const hexColor = makeHexColorCache();
  const barVerts = [];
  const barCols = [];
  const barIdx = [];
  const renderedEdges = new Set();
  const halfW = (FRAME_BAR_WIDTH / 2) * scale;
  const halfT = (FRAME_BAR_THICKNESS / 2) * scale;  // 以壳面为中心，向两侧各突出 halfT
  const tv = new THREE.Vector3(); // 复用临时向量
  // 沿弧线点列挤出矩形截面并合并到共享杆件几何
  // 每环 4 顶点: A(+u,下) B(-u,下) C(+u,上) D(-u,上)
  const buildBar = (pts, color) => {
    const n = pts.length;
    if (n < 2) return;
    const base = barVerts.length / 3;
    let prevT = null;
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      // 切向（端点取相邻段方向；退化段沿用上一段方向，避免截面朝向翻转）
      const t = tv.subVectors(b, a);
      if (t.lengthSq() < 1e-12) {
        if (prevT) t.copy(prevT); else t.set(0, 1, 0);
      } else {
        t.normalize();
        if (!prevT) prevT = t.clone();
        else prevT.copy(t);
      }
      // 径向（壳面外法线）
      const rad = pts[i].clone().normalize();
      // 切向（横向，垂直于框架方向、贴壳面）
      const u = new THREE.Vector3().crossVectors(t, rad);
      // 截面沿径向以壳面为中心向两侧突出: 下缘向背面(球心侧)突出 halfT，上缘向外突出 halfT
      const bx = pts[i].x - rad.x * halfT, by = pts[i].y - rad.y * halfT, bz = pts[i].z - rad.z * halfT;
      const tx = pts[i].x + rad.x * halfT, ty = pts[i].y + rad.y * halfT, tz = pts[i].z + rad.z * halfT;
      const ux = u.x * halfW, uy = u.y * halfW, uz = u.z * halfW;
      // A(+u,下) B(-u,下) C(+u,上) D(-u,上)
      barVerts.push(bx + ux, by + uy, bz + uz);
      barVerts.push(bx - ux, by - uy, bz - uz);
      barVerts.push(tx + ux, ty + uy, tz + uz);
      barVerts.push(tx - ux, ty - uy, tz - uz);
      barCols.push(color.r, color.g, color.b, color.r, color.g, color.b, color.r, color.g, color.b, color.r, color.g, color.b);
    }
    for (let i = 0; i < n - 1; i++) {
      const bi = base + i * 4, bj = bi + 4;
      // 顶面(+n) / 底面(-n) / +u 侧 / -u 侧，绕序保证法线朝外
      barIdx.push(
        bi + 3, bi + 2, bj + 2, bi + 3, bj + 2, bj + 3,
        bi + 0, bi + 1, bj + 1, bi + 0, bj + 1, bj + 0,
        bi + 0, bj + 0, bj + 2, bi + 0, bj + 2, bi + 2,
        bi + 1, bi + 3, bj + 3, bi + 1, bj + 3, bj + 1,
      );
    }
  };
  const re = (id1, id2, color, type = 0) => {
    const k = _edgeKey(id1, id2);
    if (renderedEdges.has(k)) return;
    renderedEdges.add(k);
    const f = nodeMap.get(id1), t = nodeMap.get(id2);
    if (!f || !t) return;
    const pts = (type === 1 && shPole) ? _gridArcPoints(f, t, 18, shPole) : _sphericalArcPoints(f, t, 18);
    buildBar(pts, hexColor(color));
  };
  if (shData.frames) {
    shData.frames.forEach(fr => {
      if (!fr) return;
      const k = _edgeKey(fr.relation[0], fr.relation[1]);
      ftMap.set(k, fr.type);
      re(fr.relation[0], fr.relation[1], _toHexColor(fr.color, 0x175473), fr.type);
    });
  }
  if (barVerts.length) {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(barVerts, 3));
    geom.setAttribute('color', new THREE.Float32BufferAttribute(barCols, 3));
    geom.setIndex(barIdx);
    geom.computeVertexNormals();
    // 与节点相同的材质（节点为 8 段球体 InstancedMesh），杆件端部埋入节点球体内
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.2, roughness: 0.6 });
    shellGroup.add(new THREE.Mesh(geom, mat));
  }
  return ftMap;
}

// ─── 壳面: 合并为共享几何（正面顶点色，背面共享材质复用同一几何）──
function buildFaces(shData, nodeMap, shPole, ftMap, shellGroup, stencilRef, sharedBackMaterial) {
  const hexColor = makeHexColorCache();
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
    group.add(new THREE.Mesh(geom, sharedBackMaterial)); // BackSide 复用同一几何
    shellGroup.add(group);
  }
}

// ─── 涂色网格 (fillGrid): 仅在本层壳面区域显示（模板测试）────────
function buildPainting(shData, shQuat, renderR, scale, shellGroup, stencilRef) {
  const paintingMeshes = [];
  if (shData.fillGrid?.colors) {
    const parts = buildPaintingGeometry(shData.fillGrid);
    if (parts) {
      const paintR = renderR * scale * 1.0015; // 略高于壳面避免重叠闪烁
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
        shellGroup.add(mesh);
        paintingMeshes.push(mesh);
      }
    }
  }
  return paintingMeshes;
}

// ─── 壳层构建: 编排以上四个阶段 ───────────────────────────────
export function buildShellLayer(shData, orbit, scale, nodeGeom, sharedBackMaterial) {
  const renderR = orbit.radius;
  const shQuat = _normQuat(orbit);
  const poleRaw = new THREE.Vector3(0, 1, 0); poleRaw.applyQuaternion(shQuat);
  const shPole = _convertBP(poleRaw);
  const shellGroup = new THREE.Group();
  // 本层专属模板值（与游戏一致: layerId+200）
  const stencilRef = STENCIL_BASE + (orbit.id || 0);

  // 收集节点: 坐标变换 + 颜色，建立 id → 位置映射
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

  buildNodes(nodeData, shellGroup, nodeGeom, scale);
  const ftMap = buildFrames(shData, nodeMap, shPole, shellGroup, scale);
  buildFaces(shData, nodeMap, shPole, ftMap, shellGroup, stencilRef, sharedBackMaterial);
  const paintingMeshes = buildPainting(shData, shQuat, renderR, scale, shellGroup, stencilRef);

  return {
    group: shellGroup,
    pole: shPole.clone().normalize(),
    paintingMeshes,
  };
}
