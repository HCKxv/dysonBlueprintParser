/**
 * PaintingPreview — 彩绘生成的球面预览
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  buildSphere,
  buildGraticuleBands,
  buildGraticuleLines,
  buildGraticuleGeometry,
} from '../preview/paintingGrid.js';

/** 涂色覆盖层相对壳面的高度 */
const PAINT_RADIUS_SCALE = 1.0015;

/**
 * 透明层的绘制顺序: 网格线必须晚于涂色层，否则线先和球面底色合成并写入深度、涂色被挡掉，
 * 线就固定成「白 × 不透明度 + 球面底色」的灰白，看不出底下的颜色。
 */
const PAINT_RENDER_ORDER = 3;
const PAINT_GLOW_RENDER_ORDER = 4;
const GRID_LINE_RENDER_ORDER = 5;
const GRID_LINE_MAJOR_RENDER_ORDER = 6;

/**
 * 展开图基准宽度 1920×960。
 * 1920 是各纬度带格数 {16,32,64,80,128,160,240} 的公倍数、960 是带数 120 的倍数，
 * 所以取它的整数倍时每格都是整数像素、边界正好落在像素上（不需要取整）。
 */
export const FLAT_MAP_BASE_WIDTH = 1920;

/** 纬度带数（180° / 1.5°） */
const LAT_BAND_COUNT = 120;

/** 展开图网格线颜色（只用于预览叠加层，比 3D 里的略实一点） */
const FLAT_MAP_GRID_COLOR = 'rgba(255, 255, 255, 0.45)';

/** 展开图粗网格线颜色: 每 4 格一条的「主网格」，与游戏网格资产的粗细两级一致 */
const FLAT_MAP_GRID_MAJOR_COLOR = 'rgba(255, 255, 255, 0.9)';

/** 默认视角: 正视本初子午线（赤道）时的相机距离 */
export const DEFAULT_VIEW_DISTANCE = 3.6;

/**
 * 默认视角的相机位置: 正视「中心经线、赤道」
 * 游戏局部坐标 (纬度 0、经度 L) = (sin L, 0, -cos L)，z 取反后场景坐标 = (sin L, 0, cos L)
 * @param {number} lng 中心经度（度），与 store 的 painting.hemiLng 相同
 * @param {number} distance 相机到球心的距离
 */
export function centerViewPosition(lng, distance) {
  const rad = ((Number.isFinite(Number(lng)) ? Number(lng) : 0) * Math.PI) / 180;
  return { x: Math.sin(rad) * distance, y: 0, z: Math.cos(rad) * distance };
}

class PaintingPreview {
  constructor() {
    this._renderer = null;
    this._canvas = null;
    this._scene = null;
    this._camera = null;
    this._controls = null;
    this._occluder = null;
    this._gridLines = null;
    this._gridLinesMajor = null;
    this._paintGroup = null;
    this._paintMeshes = [];
    this._fillGrid = null;
    this._root = null;
    this._gridReady = false;
    /** 默认视角的中心经度（度），跟随「经度偏移」更新 */
    this._centerLng = 0;
    /** 默认视角的相机距离（滚轮缩放后同步） */
    this._viewDistance = DEFAULT_VIEW_DISTANCE;
    this._needsRender = true;
    this._frameId = null;
    this._resizeObserver = null;
  }

  init(canvas) {
    if (this._renderer) this.dispose();

    this._canvas = canvas;
    this._scene = new THREE.Scene();
    this._scene.background = new THREE.Color(0x0A0F1A);

    this._camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    // 正视本初子午线、赤道（z 取反后游戏 (0°,0°) 落在 +Z 一侧）
    this._camera.position.set(0, 0, DEFAULT_VIEW_DISTANCE);

    this._renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this._renderer.setSize(canvas.clientWidth || 1, canvas.clientHeight || 1, false);
    this._renderer.outputColorSpace = THREE.SRGBColorSpace;

    this._controls = new OrbitControls(this._camera, canvas);
    this._controls.enableDamping = true;
    this._controls.enablePan = false;
    this._controls.minDistance = 1.1;
    this._controls.maxDistance = 8;
    this._controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: null };
    this._controls.touches = { ONE: null, TWO: THREE.TOUCH.DOLLY_ROTATE };
    canvas.style.touchAction = 'pan-y';
    this._controls.addEventListener('change', () => { this._needsRender = true; });

    this._root = new THREE.Group();
    this._scene.add(this._root);

    // 遮挡球: 只写深度、不写颜色，用来挡住背面的网格线（涂色层和网格线都在它外侧）。
    const sphereGeom = new THREE.BufferGeometry();
    const sphere = buildSphere(180, 90);
    const sPos = new Float32Array(sphere.positions.length);
    for (let i = 0; i < sphere.positions.length; i += 3) {
      sPos[i] = sphere.positions[i];
      sPos[i + 1] = sphere.positions[i + 1];
      sPos[i + 2] = -sphere.positions[i + 2];
    }
    sphereGeom.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
    sphereGeom.setIndex(new THREE.BufferAttribute(sphere.indices, 1));
    this._occluder = new THREE.Mesh(
      sphereGeom,
      new THREE.MeshBasicMaterial({ colorWrite: false }),
    );
    this._root.add(this._occluder);

    // 涂色网格线: 粗细两级（每 4 格一条粗线，权重 1.0:0.2）
    // renderOrder 晚于涂色层才是透明叠加；不写深度，背面仍由深度测试隐藏
    this._gridLines = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28, depthWrite: false }),
    );
    this._gridLinesMajor = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    // 比涂色层再高一点: 两者弦面贴合后要有明确深度差，否则同深度会闪烁
    this._gridLines.scale.setScalar(PAINT_RADIUS_SCALE + 0.0006);
    this._gridLinesMajor.scale.setScalar(PAINT_RADIUS_SCALE + 0.0006);
    // 网格线画在涂色层之后（粗线在细线之后，交叉处由粗线压住）
    this._gridLines.renderOrder = GRID_LINE_RENDER_ORDER;
    this._gridLinesMajor.renderOrder = GRID_LINE_MAJOR_RENDER_ORDER;
    this._root.add(this._gridLines);
    this._root.add(this._gridLinesMajor);

    // 涂色覆盖层（只画已涂色的格子）
    this._paintGroup = new THREE.Group();
    this._paintGroup.name = 'painting';
    this._root.add(this._paintGroup);

    this._resizeObserver = new ResizeObserver(() => this.resize());
    this._resizeObserver.observe(canvas.parentElement || canvas);

    this.setGridVisible(true);
    this._startLoop();
  }

  // ─── 网格线（只用经纬线网格） ─────────────────────────────────
  /** 显示/隐藏网格线（网格几何只在第一次调用时构建） */
  setGridVisible(visible = true) {
    if (!this._gridReady) {
      this._gridReady = true;
      const grid = buildGraticuleLines();
      const pos = grid.positions;
      // z 取反（与其他层一致）；两档共用这份顶点缓冲，各带一串线段索引
      const pts = new Float32Array(pos.length);
      for (let i = 0; i < pos.length; i += 3) {
        pts[i] = pos[i];
        pts[i + 1] = pos[i + 1];
        pts[i + 2] = -pos[i + 2];
      }
      // 用线段端点对当索引（三角形的边含内部对角线，会画到色块中间）
      const posAttr = new THREE.Float32BufferAttribute(pts, 3);
      const build = (idx) => {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', posAttr);
        geo.setIndex(new THREE.BufferAttribute(idx, 1));
        return geo;
      };
      this._gridLines.geometry.dispose();
      this._gridLines.geometry = build(grid.lineIndices);
      this._gridLinesMajor.geometry.dispose();
      this._gridLinesMajor.geometry = build(grid.lineIndicesMajor);
      // 网格建好后重建涂色几何（需要一个网格存在时的初始化时机）
      this._rebuildPainting();
    }
    this._gridLines.visible = visible;
    this._gridLinesMajor.visible = visible;
    this._needsRender = true;
  }

  // ─── 涂色覆盖层 ─────────────────────────────────────────────
  /** 设置要显示的涂色数据（只渲染已涂色的格子） */
  setPainting(fillGrid) {
    this._fillGrid = fillGrid && fillGrid.colors ? fillGrid : null;
    this._rebuildPainting();
  }

  _clearPaintMeshes() {
    for (const mesh of this._paintMeshes) {
      this._paintGroup.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this._paintMeshes = [];
  }

  _rebuildPainting() {
    this._clearPaintMeshes();
    this._needsRender = true;
    if (!this._fillGrid) return;

    // 只支持经纬线网格（gridType 0），别的网格类型不渲染涂色
    if ((this._fillGrid.gridType ?? 0) !== 0) return;

    const parts = buildGraticuleGeometry(this._fillGrid.colors);
    if (!parts) return;

    const paintR = PAINT_RADIUS_SCALE; // 略高于遮挡球，避免深度重叠闪烁
    for (const part of parts) {
      const geom = new THREE.BufferGeometry();
      const count = part.positions.length / 3;
      const posArr = new Float32Array(part.positions.length);
      // z 取反（与其他层一致），再放大到涂色半径
      for (let i = 0; i < count; i += 1) {
        posArr[i * 3] = part.positions[i * 3] * paintR;
        posArr[i * 3 + 1] = part.positions[i * 3 + 1] * paintR;
        posArr[i * 3 + 2] = -part.positions[i * 3 + 2] * paintR;
      }
      geom.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
      // 涂色数据的 a 是笔刷强度（a>0 已涂色、a>127 超亮），不是透明度: 这里一律置 1
      const src = part.colors;
      const cols = new Float32Array(src.length);
      cols.set(src);
      for (let i = 3; i < cols.length; i += 4) cols[i] = 1;
      geom.setAttribute('color', new THREE.Float32BufferAttribute(cols, 4));
      const mat = new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: true,
        side: THREE.FrontSide, // 单面渲染，双面叠加会让超亮格子发白
        blending: part.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.renderOrder = part.additive ? PAINT_GLOW_RENDER_ORDER : PAINT_RENDER_ORDER;
      mesh.frustumCulled = false;
      this._paintGroup.add(mesh);
      this._paintMeshes.push(mesh);
    }
  }

  /**
   * 把当前涂色数据摊平成展开图（列 = 经度 0-360°，行 = 纬度北在上）
   * 只画颜色，网格线是预览叠加层（见 drawFlatMapGrid）
   * @param {number} [scale=1] 相对基准尺寸 1920×960 的倍数
   * @returns {HTMLCanvasElement|null}
   */
  exportFlatMap(scale = 1) {
    if (!this._fillGrid) return null;
    if ((this._fillGrid.gridType ?? 0) !== 0) return null;

    const w = FLAT_MAP_BASE_WIDTH * Math.max(1, Math.round(scale));
    const h = w / 2;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const img = ctx.createImageData(w, h);
    const d = img.data;
    const colors = this._fillGrid.colors || [];
    const rowH = h / LAT_BAND_COUNT; // 整数

    for (const band of buildGraticuleBands()) {
      const cellW = w / band.seg; // 整数
      // 北极为第 0 行
      const y0 = (LAT_BAND_COUNT / 2 - 1 - band.latIdx) * rowH;
      const y1 = y0 + rowH;
      for (let li = 0; li < band.seg; li += 1) {
        const c = colors[band.base + li];
        if (!c || c.a <= 0) continue;
        const x0 = li * cellW;
        const xEnd = x0 + cellW;
        for (let y = y0; y < y1; y += 1) {
          let p = (y * w + x0) * 4;
          for (let x = x0; x < xEnd; x += 1) {
            d[p] = c.r; d[p + 1] = c.g; d[p + 2] = c.b; d[p + 3] = 255;
            p += 4;
          }
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  /**
   * 在给定画布上画展开图的网格线（透明背景，只有线），只用于预览叠加
   * @param {HTMLCanvasElement} canvas 目标画布（由调用方持有）
   * @param {number} [scale=1] 尺寸倍数，与 exportFlatMap 相同
   * @returns {number} 画出的宽度；0 = 失败
   */
  drawFlatMapGrid(canvas, scale = 1) {
    if (!canvas) return 0;
    const w = FLAT_MAP_BASE_WIDTH * Math.max(1, Math.round(scale));
    const h = w / 2;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return 0;

    ctx.clearRect(0, 0, w, h);
    const rowH = h / LAT_BAND_COUNT;
    const bands = buildGraticuleBands();

    // 粗细两级（每 4 格一条粗线，与 3D 网格同源）: 粗、细各扫一遍，细线跳过粗线所在位置
    const drawPass = (major) => {
      ctx.fillStyle = major ? FLAT_MAP_GRID_MAJOR_COLOR : FLAT_MAP_GRID_COLOR;
      const step = major ? 4 : 1;
      const first = major ? 0 : 1;
      // 纬线: 每条纬度带的上边界（第 k 行边界 latIdx = 60-k，k%4==0 即粗线）
      for (let k = first; k < LAT_BAND_COUNT; k += step) ctx.fillRect(0, k * rowH, w, 1);
      // 经线: 每个带里每格的左边界
      for (const band of bands) {
        const cellW = w / band.seg;
        const y0 = (LAT_BAND_COUNT / 2 - 1 - band.latIdx) * rowH;
        for (let li = first; li < band.seg; li += step) ctx.fillRect(li * cellW, y0, 1, rowH);
      }
    };
    drawPass(false);
    drawPass(true);
    return w;
  }

  /** 复位视角: 正视当前中心经线、赤道（距离保持滚轮缩放后的值） */
  resetView() {
    this._applyView(this._viewDistance);
  }

  /**
   * 默认视角跟随经度偏移: 转到中心经线正前方
   * 只转水平方向，距离与俯仰角保持现状（不影响用户的滚轮缩放）
   * @param {number} lng 半球中心经度（度），与 store 的 painting.hemiLng 一致
   */
  setCenterLongitude(lng) {
    this._centerLng = Number.isFinite(Number(lng)) ? Number(lng) : 0;
    if (!this._camera || !this._controls) return;
    this._applyView(this._camera.position.length());
  }

  /** 把相机放到中心经线正前方，距离为 distance */
  _applyView(distance) {
    const d = Math.min(8, Math.max(1.1, Number(distance) || DEFAULT_VIEW_DISTANCE));
    this._viewDistance = d;
    const pos = centerViewPosition(this._centerLng, d);
    this._camera.position.set(pos.x, pos.y, pos.z);
    this._controls.target.set(0, 0, 0);
    this._controls.update();
    this._needsRender = true;
  }

  resize() {
    const canvas = this._canvas;
    if (!canvas || !this._renderer) return;
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    this._renderer.setSize(w, h, false);
    this._camera.aspect = w / h;
    this._camera.updateProjectionMatrix();
    this._needsRender = true;
  }

  _startLoop() {
    const tick = () => {
      this._frameId = requestAnimationFrame(tick);
      if (!this._needsRender) return;
      this._needsRender = false;
      this._controls.update();
      this._renderer.render(this._scene, this._camera);
    };
    tick();
  }

  dispose() {
    if (this._frameId != null) cancelAnimationFrame(this._frameId);
    this._frameId = null;
    this._resizeObserver?.disconnect();
    this._resizeObserver = null;
    this._controls?.dispose();
    this._controls = null;
    this._clearPaintMeshes();
    this._gridLines?.geometry.dispose();
    this._gridLines?.material.dispose();
    this._gridLinesMajor?.geometry.dispose();
    this._gridLinesMajor?.material.dispose();
    this._occluder?.geometry.dispose();
    this._occluder?.material.dispose();
    this._renderer?.dispose();
    this._renderer = null;
    this._scene = null;
  }
}

export { PaintingPreview };
