/**
 * buildShell — 戴森壳层渲染对象构建（由 preview.js render() 调用）
 *
 * 纯构建函数，通过 ctx 注入宿主资源，不依赖 DysonSpherePreview 实例。
 * ctx: {
 *   root: THREE.Group,               // 挂载目标（_rootGroup）
 *   vis: Map<string, Object3D>,      // 可见性注册表（_visObjects）
 *   scale: number,                   // 当前缩放系数（_currentScale）
 *   nodeGeom: SphereGeometry,        // 共享节点球体几何
 *   sharedBackMaterial: Material,    // 共享壳面背面材质
 *   shellGroups: Array,              // 自转用壳层组注册表（_shellGroups）
 *   paintingMeshes: Array,           // 涂色网格列表（_paintingMeshes）
 *   paintingVisible: boolean,        // 涂色网格显示开关
 * }
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

/**
 * 构建单个壳层的渲染对象（节点/框架/壳面/涂色网格），挂载到 ctx.root
 * @param {object} shData - shell.shells[orbit.id]（nodes/frames/faces/fillGrid）
 * @param {object} orbit  - orbitList 项（id/radius/四元数）
 * @param {boolean} gv    - 该层游戏内可见性
 * @param {object} ctx    - 见文件头注释
 */
export function buildShellLayer(shData, orbit, gv, ctx) {
  const renderR = orbit.radius;
  const shQuat = _normQuat(orbit);
  const poleRaw = new THREE.Vector3(0, 1, 0); poleRaw.applyQuaternion(shQuat);
  const shPole = _convertBP(poleRaw);
  const shellGroup = new THREE.Group();
  ctx.shellGroups.push({ group: shellGroup, pole: shPole.clone().normalize(), radius: renderR });
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
      const pos = _convertBP(d).multiplyScalar(renderR * ctx.scale);
      nodeMap.set(nd.id, pos);
      nodeData.push({ pos, color: _toHexColor(nd.color, 0x60D6FD) });
    }
  }
  // 节点: InstancedMesh 合并为一次绘制
  if (nodeData.length) {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x0a2f20, metalness: 0.2, roughness: 0.6 });
    const inst = new THREE.InstancedMesh(ctx.nodeGeom, mat, nodeData.length);
    const m4 = new THREE.Matrix4();
    const c = new THREE.Color();
    const s = 50 * ctx.scale;
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
    group.add(new THREE.Mesh(geom, ctx.sharedBackMaterial)); // BackSide 复用同一几何
    shellGroup.add(group);
  }

  // ── 涂色网格 (fillGrid) ──
  if (shData.fillGrid?.colors) {
    const parts = buildPaintingGeometry(shData.fillGrid);
    if (parts) {
      const paintR = renderR * ctx.scale * 1.0015; // 略高于壳面避免重叠闪烁
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
        mesh.visible = ctx.paintingVisible;
        shellGroup.add(mesh);
        ctx.paintingMeshes.push(mesh);
      }
    }
  }

  shellGroup.visible = gv;
  ctx.vis.set('shell_' + orbit.id, shellGroup);
  ctx.root.add(shellGroup);
}
