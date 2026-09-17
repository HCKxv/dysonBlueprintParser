/**
 * buildShell — 壳层渲染对象组装
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { applyCellPatterns, buildBackCells } from './shellPattern.js';

// 节点（简化模型）: 主体圆柱 + 朝内的细圆柱 + 朝外发光端面（节点颜色）
const NODE_BODY_RADIUS = 36;     // 主体圆柱半径（蓝图单位）
const NODE_BODY_HEIGHT = 46;     // 主体圆柱高度（沿径向）
const NODE_CAP_RADIUS = 20;      // 朝外发光圆片半径（比主体小一圈）
const NODE_STALK_RADIUS = 7;     // 细圆柱半径
const NODE_STALK_LENGTH = 108;   // 细圆柱长度（朝内伸出）

/**
 * 构建节点的两套几何（蓝图单位，轴沿 +Y = 径向外）:
 *   body —— 主体圆柱 + 朝内的细圆柱（用节点颜色、受光）
 *   cap  —— 朝外端面（发光，用节点颜色）
 * 真实模型由 assembleNodes 用每实例的旋转把 +Y 对齐到各自节点的径向。
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

// ═══════════════════════════════════════════════════════════════
// Worker: 整层几何计算
// ═══════════════════════════════════════════════════════════════

// 进程内复用一只；报错/超时/被新构建取代后丢弃，下次重建
let layerWorker = null;
// 当前在飞请求的失败回调: 供 cancelLayerWorker() 主动中止
let pendingAbort = null;

/** 单层构建时限（毫秒）: 超时判定在主线程，超时即终止 Worker 并让 render 的 catch 接手 */
const LAYER_BUILD_TIMEOUT_MS = 30000;

/**
 * 立即中止正在进行的层构建（新一次 render 开始时调用）
 *
 * 必要性: Worker 单线程，postMessage 只会排队——不终止的话，上一次还在算的那一层
 * 会把新构建堵在队列里，直到 30s 看门狗误报"超时"。旧的那次 await 会立刻以错误
 * 退出，render 的 catch 按令牌判断，不会误报错误提示。
 */
export function cancelLayerWorker() {
  pendingAbort?.(new Error('构建已取消'));
}

/**
 * 把一整层的几何计算交给 Worker，并用主线程的看门狗限时。
 * 超时（或 Worker 报错）都会 reject —— 由 buildShellLayer 抛出、render 的 catch 接手。
 * @param {{shData: object, orbit: object, scale: number}} payload
 * @returns {Promise<object>} { nodes, frames, cells, painting, pole }
 */
function computeLayerInWorker(payload, timeoutMs = LAYER_BUILD_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let w;
    try {
      if (!layerWorker) {
        layerWorker = new Worker(new URL('./shellLayer.worker.js', import.meta.url), { type: 'module' });
      }
      w = layerWorker;
    } catch (err) { reject(err); return; }
    let settled = false;
    const cleanup = () => {
      w.removeEventListener('message', onMsg);
      w.removeEventListener('error', onErr);
      clearTimeout(timer);
      pendingAbort = null;
    };
    const fail = (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      layerWorker?.terminate();   // 出错/超时/取消后整只丢弃，下次重建
      layerWorker = null;
      reject(err);
    };
    pendingAbort = fail;   // 供 cancelLayerWorker() 中止
    function onMsg(e) {
      if (settled) return;
      settled = true;
      cleanup();
      if (e.data && e.data.error) { fail(new Error(e.data.error)); return; }
      resolve((e.data && e.data.layer) || null);
    }
    function onErr(e) { fail(new Error((e && e.message) || 'Worker 执行出错')); }
    // 主线程看门狗: Worker 不参与计时，超时直接终止它（卡住的计算不会继续烧 CPU）
    const timer = setTimeout(
      () => fail(new Error(`构建超时`)), timeoutMs);
    w.addEventListener('message', onMsg);
    w.addEventListener('error', onErr);
    w.postMessage(payload);
  });
}

// ═══════════════════════════════════════════════════════════════
// 组装
// ═══════════════════════════════════════════════════════════════

/**
 * 细胞板: 按图案分组的多个 Mesh（一个材质只能采样一套图案贴图，同一壳面可混用多种图案）
 *
 * 图案补丁由 buildShellLayer 统一补上（applyCellPatterns），这里只管几何与材质。
 * @param {Array<{pattern:number, positions:Float32Array, normals:Float32Array, colors:Float32Array,
 *   patternUV:Float32Array, patternMN:Float32Array, indices:Uint32Array}>} bucketList
 * @returns {THREE.Group|null}
 */
function assembleShellCells(bucketList) {
  if (!bucketList || !bucketList.length) return null;
  const group = new THREE.Group();
  group.name = 'shellCells';
  for (const buf of bucketList) {
    if (!buf.positions.length) continue;
    const pattern = buf.pattern;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(buf.positions, 3));
    geom.setAttribute('normal', new THREE.Float32BufferAttribute(buf.normals, 3));
    geom.setAttribute('color', new THREE.Float32BufferAttribute(buf.colors, 3));
    geom.setAttribute('aPatternUV', new THREE.Float32BufferAttribute(buf.patternUV, 2));
    geom.setAttribute('aPatternMN', new THREE.Float32BufferAttribute(buf.patternMN, 2));
    // 索引显式包 BufferAttribute: setIndex 对 TypedArray 会原样存下，渲染器随后会崩
    geom.setIndex(new THREE.Uint32BufferAttribute(buf.indices, 1));

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      side: THREE.FrontSide,
      depthWrite: true,
      metalness: 0.25,
      roughness: 0.55,
    });

    const mesh = new THREE.Mesh(geom, mat);
    mesh.name = `shellCells:${pattern}`;
    mesh.userData.shellPattern = pattern;
    mesh.frustumCulled = false;
    group.add(mesh);
  }
  return group.children.length ? group : null;
}

/** 节点: 两个 InstancedMesh（本体 + 发光端面） */
function assembleNodes(nodes, shellGroup, nodeGeoms, scale) {
  if (!nodes || !nodes.count || !nodeGeoms) return;
  const { body, cap, yAxis } = nodeGeoms;
  // 双面: 从壳体内侧看节点时，圆柱的内表面同样要挡住后面的端面
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x4a4f55, metalness: 0.25, roughness: 0.6, side: THREE.DoubleSide,   // 深灰
  });
  // 端面发光: 用 Basic + 实例色（实例色会乘进材质色），不受光照衰减
  const capMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  const bodyInst = new THREE.InstancedMesh(body, bodyMat, nodes.count);
  const capInst = new THREE.InstancedMesh(cap, capMat, nodes.count);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const dir = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const sc = new THREE.Vector3(scale, scale, scale);
  const c = new THREE.Color();
  for (let i = 0; i < nodes.count; i++) {
    pos.set(nodes.positions[i * 3], nodes.positions[i * 3 + 1], nodes.positions[i * 3 + 2]);
    // 让几何的 +Y 对齐该节点的径向（朝外），于是细圆柱自动朝太阳
    dir.copy(pos).normalize();
    q.setFromUnitVectors(yAxis, dir);
    m4.compose(pos, q, sc);
    bodyInst.setMatrixAt(i, m4);
    capInst.setMatrixAt(i, m4);
    // 只有朝外端面用节点颜色（发光）；主体保持材质本色（金属灰）
    capInst.setColorAt(i, c.setHex(nodes.colors[i]));
  }
  for (const inst of [bodyInst, capInst]) {
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    inst.frustumCulled = false;
    shellGroup.add(inst);
  }
}

/** 框架: 外侧面（框架本色）+ 径向内侧面（恒星色，从壳体内侧看到的就是它） */
function assembleFrames(frames, shellGroup, sharedBackMaterial) {
  if (!frames || !frames.indices.length) return;
  const posAttr = new THREE.Float32BufferAttribute(frames.positions, 3);
  const colAttr = new THREE.Float32BufferAttribute(frames.colors, 3);

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', posAttr);
  geom.setAttribute('color', colAttr);
  // 索引显式包 BufferAttribute: setIndex 对 TypedArray 会原样存下，渲染器随后会崩
  geom.setIndex(new THREE.Uint32BufferAttribute(frames.indices, 1));
  geom.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.2, roughness: 0.6 });
  shellGroup.add(new THREE.Mesh(geom, mat));

  const backGeom = new THREE.BufferGeometry();
  backGeom.setAttribute('position', posAttr);
  backGeom.setAttribute('color', colAttr);
  backGeom.setIndex(new THREE.Uint32BufferAttribute(frames.backIndices, 1));
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

/** 涂色: 建烘焙源 Group（不加入场景，交给 bakeShellPainting 烘成立方体贴图） */
function assemblePainting(parts) {
  if (!parts || !parts.length) return null;
  const group = new THREE.Group();
  group.name = 'shellPaintingSource';
  for (const part of parts) {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(part.positions, 3));
    geom.setAttribute('color', new THREE.Float32BufferAttribute(part.colors, 4));
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: true,
      // 只用于从球心往外的立方体烘焙: 相机在球内看到的是内侧 ⇒ 用 BackSide
      side: THREE.BackSide,
      blending: part.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.frustumCulled = false;
    group.add(mesh);
  }
  return group;
}

/**
 * 构建一个壳层的全部渲染对象（节点、框架、细胞板、背面图案层、涂色烘焙源）。
 *
 * 几何在 Worker 里算（不回退主线程）；失败或超时直接抛出，由上层放弃整次构建。
 *
 * @param {object} shData               壳层数据（nodes / frames / faces / fillGrid）
 * @param {object} orbit                轨道对象，取 radius 与姿态四元数
 * @param {number} scale                缩放系数（= 1 / 最大轨道半径）
 * @param {{body: THREE.BufferGeometry, cap: THREE.BufferGeometry}} nodeGeoms  共享的节点几何
 * @param {THREE.Material} sharedBackMaterial  恒星色背板材质（背面与框架内侧面共用配色）
 * @returns {Promise<{group: THREE.Group, pole: THREE.Vector3, cells: THREE.Group|null, paintingGroup: THREE.Group|null}>}
 *          group 为整层（含背面），cells 仅正面细胞，paintingGroup 为涂色烘焙源
 */
export async function buildShellLayer(shData, orbit, scale, nodeGeoms, sharedBackMaterial) {
  const layer = await computeLayerInWorker({ shData, orbit, scale });
  if (!layer) throw new Error('Worker 未返回壳层数据');

  const shellGroup = new THREE.Group();

  assembleNodes(layer.nodes, shellGroup, nodeGeoms, scale);
  assembleFrames(layer.frames, shellGroup, sharedBackMaterial);

  const cellMesh = assembleShellCells(layer.cells);
  if (cellMesh) {
    shellGroup.add(cellMesh);
    // 图案补丁（按各细胞的图案）+ 背面图案层（几何共用、只画图案）
    applyCellPatterns(cellMesh, orbit);
    buildBackCells(cellMesh, shellGroup, sharedBackMaterial, orbit);
  }

  const paintingGroup = assemblePainting(layer.painting);

  return {
    group: shellGroup,
    pole: new THREE.Vector3(layer.pole.x, layer.pole.y, layer.pole.z).normalize(),
    cells: cellMesh,
    paintingGroup,
  };
}
