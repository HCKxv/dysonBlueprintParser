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
import { buildCloudOrbits } from './buildCloud.js';
import { buildShellLayer } from './buildShell.js';
import { getStarColors } from './starColors.js';

class DysonSpherePreview {
  constructor() {
    this._scene = null;
    this._camera = null;
    this._renderer = null;
    this._controls = null;
    this._canvas = null;

    this._rootGroup = null;
    this._gridGroup = null;
    this._gridLabelTexture = null;
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

    this._nodeGeom = null;
    this._sharedBackMaterial = null;

    // 绑定的事件回调引用，用于 dispose
    this._onBlur = null;
  }

  // ─── 1. 初始化场景 ─────────────────────────────────────────

  /**
   * @param {HTMLCanvasElement} canvas
   */
  init(canvas) {
    if (this._renderer) this.dispose();

    if (!this._nodeGeom) this._nodeGeom = new THREE.SphereGeometry(1, 8, 8);
    if (!this._sharedBackMaterial) this._sharedBackMaterial = new THREE.MeshBasicMaterial({ color: getStarColors(1.0).back, opacity: 1, transparent: true, side: THREE.BackSide, depthWrite: true });

    this._canvas = canvas;

    this._scene = new THREE.Scene();
    this._scene.background = new THREE.Color(0x3C5765);

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

    // 构建上下文（依赖注入：云/壳构建模块不依赖类实例）
    const ctx = {
      root: this._rootGroup,
      vis: this._visObjects,
      scale: this._currentScale,
      nodeGeom: this._nodeGeom,
      sharedBackMaterial: this._sharedBackMaterial,
      shellGroups: this._shellGroups,
      paintingMeshes: this._paintingMeshes,
      paintingVisible: this._paintingVisible,
    };

    // ── 云轨道 ──
    buildCloudOrbits(cloud, ctx);

    // ── 壳层 ──
    if (shell?.orbitList) {
      for (let i = 0; i < shell.orbitList.length; i++) {
        const orbit = shell.orbitList[i];
        if (!orbit) continue;
        const shData = shell.shells?.[orbit.id] ?? null;
        if (!shData) continue;
        const gv = shell.visibility ? shell.visibility.inGame[orbit.id] : true;
        buildShellLayer(shData, orbit, gv, ctx);
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
    if (this._gridGroup) {
      this._gridGroup.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const m of mats) m.dispose();
        }
      });
      this._gridGroup = null;
    }
    if (this._gridLabelTexture) { this._gridLabelTexture.dispose(); this._gridLabelTexture = null; }
    if (this._sharedBackMaterial) { this._sharedBackMaterial.dispose(); this._sharedBackMaterial = null; }
    if (this._nodeGeom) { this._nodeGeom.dispose(); this._nodeGeom = null; }
    if (this._renderer) { this._renderer.dispose(); this._renderer = null; }
    if (this._controls) { this._controls.dispose(); this._controls = null; }
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
    this._gridLabelTexture = labelTex;
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

export { DysonSpherePreview };
