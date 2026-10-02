/**
 * cameraRig — 工厂预览的相机与操作（**贴地表面行走**那一套）
 *
 * 观察点在球面上走、相机始终盯住它，`camera.up` = 观察点当地法线。操作: 左键拖动 / W/A/S/D 挪观察点、
 * 中键拖动绕当地竖轴转台、滚轮改取景距离（观察点不动，但仰角下限是距离的函数，缩放后必须重夹，见 tick）。
 * OrbitControls 只留滚轮缩放与阻尼 —— 另外两个预览是「绕球心转」，那套十几行就够，与这里不共用。
 *
 * 本模块 = 机位数学 + 指针拖动 + 点击判定；场景与蓝图、按键集合在 FactoryPreview。
 * 它**不认识蓝图**（不 import blueprintLayout）: 取景只认 (lat, lng, 距离, 仰角)，见 setHome。
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DEG, CELL_SCENE, PLANET_RADIUS, directionToLatLng, northDirection, surfaceDirection } from './planetFrames.js';

/** 视角距离（相机到观察点，观察点在球面上） */
export const MIN_VIEW_DISTANCE = 0.1;    // 快贴到地面，够看单个方块
export const MAX_VIEW_DISTANCE = 4;      // 退到能看全整颗行星

/** 相机竖向视野（度） */
export const CAMERA_FOV_DEG = 38;

/**
 * 打开蓝图后的机位仰角（游戏主视角默认俯角 30°）: 必须 < 90°，否则相机正对法线
 * （极角 = 0）时水平拖动会退化成绕视线原地滚转，而不是绕当地竖直轴转。
 */
const HOME_ELEVATION_RAD = 60 * DEG;

/** 相机离地表的最近高度: 观察点在球面上，往下转会连相机一起带进球里，兜一下 */
const CAMERA_MIN_ALTITUDE = 0.01;

/** 相机相对观察点当地地平面的仰角上限: 别正对法线（那时屏幕上下方向会退化） */
const MAX_CAMERA_ELEVATION_RAD = 75 * DEG;

/** 仰角下限随取景距离变: 最远时 = MAX_MIN_CAMERA_ELEVATION_RAD，贴地时回升到 MIN_CAMERA_ELEVATION_RAD */
const MIN_CAMERA_ELEVATION_RAD = 18 * DEG;
const MAX_MIN_CAMERA_ELEVATION_RAD = -15 * DEG;
/** 回升曲线的指数（<1）: 越靠近回升越快 —— t→0 处斜率发散，t→1 处几乎平坦 */
const MIN_ELEVATION_RAMP_POWER = 0.35;

/** 转速随距离缩放: 贴地 40%、拉到最远 100% */
const ROTATE_SPEED_NEAR = 0.4;

/**
 * 中键拖动的方向: 向右拖 = 画面内容往右走，向下拖 = 相机抬高。
 * OrbitControls 只有一个 rotateSpeed 符号，水平 / 垂直定不了各自方向，所以自己转。
 */
const DRAG_YAW_SIGN = -1;
const DRAG_PITCH_SIGN = -1;

/**
 * 左键拖动（挪观察点）的方向: 两条都取 +1 = 世界跟手（画面内容跟着鼠标走），
 * 改成「推着世界走」（内容反向）只改这里；四个方向之外不要再各自塞符号，免得下次又对不上。
 */
const PAN_SIGN_SIDE = 1;
const PAN_SIGN_FORWARD = 1;

/** 左键拖动的灵敏度: 每像素走的弧长按它缩放（1 = 屏幕 1 像素对地表 1 像素当量，调小则更迟钝） */
const PAN_SENSITIVITY = 0.75;

/** W/A/S/D 挪观察点: 键位 → 观察点要走的方向 [往屏幕右, 往屏幕里]，见 _stepByArc */
const KEY_PAN_VECTORS = {
  KeyW: [0, 1],      // 视角往前
  KeyS: [0, -1],
  KeyA: [1, 0],      // 视角往左（观察点反而往屏幕右，内容才跟着往左）
  KeyD: [-1, 0],
};

/** W/A/S/D 的速度: 每秒走 20 格 */
const KEY_PAN_CELLS_PER_SECOND = 20;
const KEY_PAN_SPEED = KEY_PAN_CELLS_PER_SECOND * CELL_SCENE;

/** 取景填充率: 蓝图大致占视野的 2/3；半径下限（度）挡住太小的蓝图，免得把相机怼到地面上 */
const FOCUS_FILL = 0.66;
const MIN_FOCUS_RADIUS_DEG = 2;

/** 取景留一点余量（斜视时近端边缘会显得更大）: 归位距离在 _homeDistance 里乘上它 */
const FOCUS_MARGIN = 1.12;

/**
 * 蓝图的两个角半径（度）→ 相机到蓝图中心的距离: 纬向按竖向视野（斜视压缩 sin 仰角）、经向按横向
 * 视野（宽 aspect 倍），取更远的那个 —— 长条蓝图才不会被经向半径推远、画面左右空一大片
 */
export function focusDistance(latRadiusDeg, lngRadiusDeg, aspect) {
  const verticalTan = Math.tan((CAMERA_FOV_DEG * DEG) / 2) * FOCUS_FILL;
  const horizontalTan = verticalTan * (aspect > 0 ? aspect : 1);
  const latRadius = Math.max(latRadiusDeg * Math.sin(HOME_ELEVATION_RAD), MIN_FOCUS_RADIUS_DEG);
  const byLat = (latRadius * DEG) / verticalTan;
  const byLng = (Math.max(0, lngRadiusDeg) * DEG) / horizontalTan;
  return Math.min(MAX_VIEW_DISTANCE, Math.max(MIN_VIEW_DISTANCE, Math.max(byLat, byLng)));
}

/**
 * 量拖动斜率时要求的最小入射角 |法线 · 视线| —— 比它更掠射的地面点不能拿来当探针。
 * 低仰角时屏幕中心（观察点）恰好贴着地平线，用那里量出的斜率会塌到极小，拖一点就把视角甩出去。
 */
const PROBE_MIN_INCIDENCE = 0.35;

/** 参与拖动的鼠标键（PointerEvent.button）: 左键挪观察点、中键转视角，其余不接管 */
const BUTTON_LEFT = 0;
const BUTTON_MIDDLE = 1;

/** _rotationAxes 的兜底轴 */
const SCREEN_RIGHT = new THREE.Vector3(1, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);

/** 点击与拖动的分界（像素）: 左键按下到抬起位移不超过它才算「点了一下」，免得拖完顺手选了建筑 */
const CLICK_MOVE_TOLERANCE = 4;

/** 焦点在输入框 / 下拉框 / 可编辑区里时，按键不归预览管（别抢 WASD） */
function isTypingTarget(element) {
  const tag = element?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element?.isContentEditable === true;
}

/** 取景距离 `distance` 下的仰角下限（弧度） */
function minElevationForDistance(distance) {
  const t = Math.min(1, Math.max(0,
    (distance - MIN_VIEW_DISTANCE) / (MAX_VIEW_DISTANCE - MIN_VIEW_DISTANCE)));
  return MIN_CAMERA_ELEVATION_RAD
    + (MAX_MIN_CAMERA_ELEVATION_RAD - MIN_CAMERA_ELEVATION_RAD)
    * Math.pow(t, MIN_ELEVATION_RAMP_POWER);
}

/** 相机到观察点的距离 → 旋转灵敏度系数（贴地慢、拉远快，线性回升） */
function rotationSpeedForDistance(distance) {
  const t = (distance - MIN_VIEW_DISTANCE) / (MAX_VIEW_DISTANCE - MIN_VIEW_DISTANCE);
  return ROTATE_SPEED_NEAR + (1 - ROTATE_SPEED_NEAR) * Math.min(1, Math.max(0, t));
}

class CameraRig {
  constructor() {
    this._camera = null;
    this._controls = null;
    this._canvas = null;
    /** 相机这一帧是否动过（脏标记: 静止时渲染循环靠它跳过绘制），见 tick */
    this._dirty = true;

    /** 视角「归位」的目标: 打开蓝图后是蓝图中心，没蓝图时是赤道 */
    this._home = { latDeg: 0, lngDeg: 0, distance: 0.5, elevationRad: HOME_ELEVATION_RAD, focusDeg: null };

    /** 正在进行的拖动: 'rotate'（中键转视角）/ 'pan'（左键挪观察点）/ null */
    this._dragMode = null;
    /** 左键拖动期间冻结的两个大圆轴与每像素斜率（按下时算好，抬起时清）: 每帧重算就不是测地线了 */
    this._dragAxisForward = null;
    this._dragAxisSide = null;
    this._dragRateForward = 0;
    this._dragRateSide = 0;
    /** 量斜率用的探针（按下时光标下的那片地，见 _dragProbeAt） */
    this._dragProbe = null;
    /** 探针求交复用的射线与行星球（惰性建） */
    this._probeRay = null;
    this._probeSphere = null;
    /** 观察点当地的球面法线 = camera.up = 中键转视角的竖直轴（统一由 _placeCamera 赋值） */
    this._pivotNormal = null;
    /** 按下起点与「动过没有」: 抬起时据此判断点击还是拖动 */
    this._pressX = 0;
    this._pressY = 0;
    this._pressMoved = false;
    /** 上一次抬起是否算「点了一下」（见 consumeClick） */
    this._clicked = false;

    /** 按住的方向键（W/A/S/D，由调用方维护后交给 setMoveKeys） */
    this._moveKeys = null;
  }

  // ─── 初始化 ─────────────────────────────────────────────────
  /**
   * 装配相机与控制器。相机由调用方 new（视野角、远近裁剪面是它的取舍），
   * 这里只管控制器的行为与后续所有机位。
   * @param {HTMLCanvasElement} canvas
   * @param {THREE.PerspectiveCamera} camera
   */
  attach(canvas, camera) {
    this._canvas = canvas;
    this._camera = camera;

    // 操作方式: 左键拖动挪观察点、中键拖动转视角（见 beginPointer）、滚轮缩放，右键留给其它交互
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.enablePan = false;            // 只绕观察点转，不把行星推出画面
    controls.minDistance = MIN_VIEW_DISTANCE;
    controls.maxDistance = MAX_VIEW_DISTANCE;
    // 旋转自己接管（见 _rotateByPixels）: OrbitControls 只有一个 rotateSpeed 符号，
    // 水平 / 垂直定不了各自方向。它继续负责滚轮缩放与阻尼。
    controls.mouseButtons = { LEFT: null, MIDDLE: null, RIGHT: null };
    controls.touches = { ONE: null, TWO: THREE.TOUCH.DOLLY_PAN };
    canvas.style.touchAction = 'pan-y';    // 触屏: 单指留给页面滚动，双指 = 缩放；拖动 / 点选只认鼠标
    // update() 只在位置 / 朝向真的变了时才返回 true 并派发 change，正好当脏标记，不必自己比距离
    controls.addEventListener('change', () => { this._dirty = true; });
    this._controls = controls;

    this._dirty = true;
  }

  // ─── 视角 ───────────────────────────────────────────────────
  /**
   * 设「归位」目标（`reset()` 与初始化都回到这里）。
   * @param {number} latDeg 观察点纬度（度）
   * @param {number} lngDeg 观察点经度（度）
   * @param {number|null} distance 取景距离；null = 按 focusDeg 现算（画布宽高比会变，复位时重算）
   * @param {number} [elevationRad] 机位仰角（弧度），默认 HOME_ELEVATION_RAD
   * @param {{latRadiusDeg: number, lngRadiusDeg: number}|null} [focusDeg] 要框住的角半径（见 focusDistance）
   */
  setHome(latDeg, lngDeg, distance, elevationRad = HOME_ELEVATION_RAD, focusDeg = null) {
    this._home = { latDeg, lngDeg, distance, elevationRad, focusDeg };
  }

  /** 复位视角: 回到当前归位目标（打开蓝图后是蓝图中心，否则是赤道 0° 经线） */
  reset() {
    this._applyHome();
  }

  /** 目标观察点（球面上的那一点） */
  get target() {
    return this._controls?.target ?? null;
  }

  /** 观察点当地的球面法线（= camera.up） */
  get normal() {
    return this._pivotNormal;
  }

  /** 当前观察点的经纬度（度） */
  onSurface() {
    return directionToLatLng(this._controls?.target ?? new THREE.Vector3(0, 0, 1));
  }

  /** 画面宽高比变了: 由渲染层在 resize 里调（相机的 aspect 与投影矩阵一起动） */
  setAspect(aspect) {
    if (!this._camera) return;
    this._camera.aspect = aspect;
    this._camera.updateProjectionMatrix();
    this._dirty = true;
  }

  /** 归位目标的取景距离: 有角半径就现算（画布宽高比会变，复位视角跟着重新框一次） */
  _homeDistance() {
    const { distance, focusDeg } = this._home;
    if (!focusDeg) return distance;
    const aspect = this._camera?.aspect > 0 ? this._camera.aspect : 1;
    return Math.min(MAX_VIEW_DISTANCE,
      focusDistance(focusDeg.latRadiusDeg, focusDeg.lngRadiusDeg, aspect) * FOCUS_MARGIN);
  }

  /** 把相机放到归位目标上: 观察点在球面、camera.up = 当地法线，从当地南侧按该仰角看过去（屏幕上方是北） */
  _applyHome() {
    if (!this._camera || !this._controls) return;
    const { latDeg, lngDeg, elevationRad } = this._home;
    const distance = this._homeDistance();
    const normal = surfaceDirection(latDeg, lngDeg);
    const target = normal.clone().multiplyScalar(PLANET_RADIUS);

    // 极角限位交给 _rotateByPixels 自己管，这里放开 OrbitControls 的，免得它把相机掰回去
    this._controls.minPolarAngle = 0;
    this._controls.maxPolarAngle = Math.PI;
    this._controls.minDistance = MIN_VIEW_DISTANCE;
    this._controls.maxDistance = MAX_VIEW_DISTANCE;

    // 机位方向: 从观察点沿当地南侧往上抬 elevationRad。`northDirection` 在极点会退化成 180° 经线那侧
    const north = northDirection(latDeg, lngDeg);
    const fromNormal = Math.PI / 2 - elevationRad;         // 距法线的夹角
    const offset = normal.clone().multiplyScalar(Math.cos(fromNormal))
      .addScaledVector(north, -Math.sin(fromNormal))
      .multiplyScalar(distance);
    this._placeCamera(target, offset, elevationRad, distance);
  }

  /**
   * 把相机摆到「观察点 + 指定偏移」上，`camera.up` 与 `_pivotNormal` 都取该处法线。
   * `offset` 只提供切向方向与仰角，长度按 `distance` 重算，仰角夹进允许区间。
   */
  _placeCamera(target, offset, elevationRad, distance) {
    const normal = target.clone().normalize();
    const elevation = this._clampElevation(elevationRad, distance);
    const next = this._offsetFor(target, offset, elevation, distance);

    this._pivotNormal = normal;
    this._camera.up.copy(normal);
    this._controls.target.copy(target);
    this._camera.position.copy(target).add(next);
    this._controls.update();       // 位置已直接写好，这次 update 只把控制器内部状态对齐（脏标记见 tick）
  }

  /** 仰角实时夹进 [minElevationForDistance(distance), MAX_CAMERA_ELEVATION_RAD] */
  _clampElevation(elevationRad, distance) {
    return Math.min(
      MAX_CAMERA_ELEVATION_RAD,
      Math.max(minElevationForDistance(distance), elevationRad),
    );
  }

  /**
   * 按当前距离重夹仰角 —— 缩放只改距离、不改仰角，下限却是距离的函数，
   * 所以滚轮之后必须重夹（否则拉远后相机一直贴在旧的低仰角上看）。
   */
  _clampCameraElevation() {
    const target = this._controls.target;
    const normal = target.clone().normalize();
    const offset = this._camera.position.clone().sub(target);
    const distance = offset.length();
    const current = this._elevationOf(offset, normal);
    const elevation = this._clampElevation(current, distance);
    if (elevation === current) return;

    const tangential = offset.clone().addScaledVector(normal, -offset.dot(normal));
    if (tangential.lengthSq() < 1e-18) return;
    this._placeCamera(target, tangential, elevation, distance);
  }

  /** 相机别钻进球里（绕球面点旋转时往下转会钻进去） */
  _keepCameraOutside() {
    const minRadius = PLANET_RADIUS + CAMERA_MIN_ALTITUDE;
    if (this._camera.position.lengthSq() >= minRadius * minRadius) return;
    this._camera.position.setLength(minRadius);
    this._dirty = true;
  }

  // ─── 渲染循环 ───────────────────────────────────────────────
  /**
   * 每帧调一次（渲染循环里），把 W/A/S/D、阻尼与仰角限位都推进一步。
   * @param {number} dt 距上一帧的秒数（<= 0 = 不按帧长走）
   * @returns {boolean} 这一帧视角是否动过 —— false 时调用方可以跳过绘制（省电）
   */
  tick(dt) {
    if (!this._camera || !this._controls) return false;
    this._moveByKeys(dt);
    // 缩放 / 阻尼都在这里生效；OrbitControls 只在真的变了时才返回 true 并派发 change
    if (this._controls.update()) this._dirty = true;
    this._clampCameraElevation();
    this._keepCameraOutside();
    const dirty = this._dirty;
    this._dirty = false;
    return dirty;
  }

  // ─── 指针操作（左键挪观察点 / 中键转视角 / 抬手算点击） ──────────────
  /** 按下: 左键挪观察点、中键转视角，其余键不接管（触屏只留双指缩放）；事件挂载在渲染层 */
  beginPointer(event) {
    if (!this._camera || event.pointerType === 'touch') return;
    if (event.button === BUTTON_MIDDLE) {
      this._dragMode = 'rotate';
      // 中键不搬输入框焦点，转完视角按 WASD 会被 isTypingTarget 拦下 —— 按下就清一次（只清输入类元素）
      if (isTypingTarget(document.activeElement)) document.activeElement.blur();
    } else if (event.button === BUTTON_LEFT) {
      this._dragMode = 'pan';
      // 两个大圆轴与每像素斜率在按下这一刻定死（见 _panByPixels）
      const target = this._controls.target;
      const { forward, left } = this._screenTangentFrame(target);
      // 绕哪个轴转，点就沿**垂直于该轴**的大圆走（容易接反）:
      //   左右拖（⊥视线）→ 绕 `forward`（视线的切向分量）
      //   上下拖（∥视线）→ 绕 `left`（= 法线 × forward）
      this._dragAxisForward = forward;
      this._dragAxisSide = left;
      // 斜率就量这两个轴的真实旋转，探针取光标下那片地（见 _dragProbeAt）
      this._dragProbe = this._dragProbeAt(event.clientX, event.clientY);
      const rates = this._tangentRates(forward, left, this._dragProbe);
      this._dragRateSide = rates.rateSide / PAN_SENSITIVITY;
      this._dragRateForward = rates.rateForward / PAN_SENSITIVITY;
    } else {
      return;
    }
    this._dragX = event.clientX;
    this._dragY = event.clientY;
    // 点击判定: 记下起点，抬起时几乎没挪窝才算「点了一下」（见 CLICK_MOVE_TOLERANCE）
    this._pressX = event.clientX;
    this._pressY = event.clientY;
    this._pressMoved = false;
    this._canvas?.setPointerCapture?.(event.pointerId);
  }

  /** 移动: 在拖动就按这一帧的位移转视角 / 挪观察点 */
  movePointer(event) {
    if (!this._dragMode || event.pointerType === 'touch') return;
    const dx = event.clientX - this._dragX;
    const dy = event.clientY - this._dragY;
    if (dx === 0 && dy === 0) return;
    this._dragX = event.clientX;
    this._dragY = event.clientY;
    if (!this._pressMoved
      && Math.hypot(event.clientX - this._pressX, event.clientY - this._pressY) > CLICK_MOVE_TOLERANCE) {
      this._pressMoved = true;                 // 拖动过了: 抬起时不再当成点击
    }
    if (this._dragMode === 'pan') this._panByPixels(dx, dy);
    else this._rotateByPixels(dx, dy);
  }

  /** 抬起: 只有 pointerup（不是 pointercancel）且左键没拖动过才算「点了一下」，结果留给 consumeClick 取 */
  endPointer(event) {
    if (!this._dragMode || event.pointerType === 'touch') return;
    this._clicked = this._dragMode === 'pan' && !this._pressMoved && event.type === 'pointerup';
    this.endDrag();
    if (this._clicked && this._canvas?.hasPointerCapture?.(event.pointerId)) {
      this._canvas.releasePointerCapture(event.pointerId);   // 仍按着时别放掉指针捕获（多点按下）
    }
  }

  /** 取走「上一次抬起算不算点了一下」并清掉（一次点击只该被消费一次），渲染层据此决定要不要拾取 */
  consumeClick() {
    const clicked = this._clicked;
    this._clicked = false;
    return clicked;
  }

  /** 结束拖动并丢掉拖动期间冻结的一切（抬起、指针被抢、销毁都走这里） */
  endDrag() {
    this._dragMode = null;
    this._dragAxisForward = null;
    this._dragAxisSide = null;
    this._dragRateForward = 0;
    this._dragRateSide = 0;
    this._dragProbe = null;
    this._pressMoved = false;
  }

  /** 交进当前按住的方向键（W/A/S/D 的 `event.code`）: 直接持有这个 Set，调用方不必每帧新建 */
  setMoveKeys(keys) {
    this._moveKeys = keys ?? null;
  }

  /** 这个键位算不算「挪观察点」的键 */
  isMoveKey(code) {
    return !!KEY_PAN_VECTORS[code];
  }

  /**
   * 按住 W/A/S/D 挪观察点。走**世界弧长**，不走拖动那条像素链: 键盘是「速度」语义（按住就一直走），
   * 像素链会把「一像素对应地上多远」算进去，速度就随仰角 / 取景距离 / 光标位置漂。
   */
  _moveByKeys(dt) {
    if (!this._moveKeys?.size || this._dragMode || !(dt > 0)) return;
    let side = 0;
    let forward = 0;
    for (const code of this._moveKeys) {
      const vector = KEY_PAN_VECTORS[code];
      if (!vector) continue;
      side += vector[0];
      forward += vector[1];
    }
    const length = Math.hypot(side, forward);
    if (!length) return;
    // 斜向归一化: 两轴各按全速算时斜 45° 是 √2 倍速
    this._stepByArc((side / length) * KEY_PAN_SPEED * dt, (forward / length) * KEY_PAN_SPEED * dt);
  }

  /**
   * 让观察点沿球面走指定弧长（半径 1，所以转角 = 弧长），`right` 往屏幕右、`forward` 往屏幕里。
   * 注意 q·v 把 v 转向 `轴 × v` 一侧: 绕 `forward` 是往 −left 走（left = normal × forward），故取负号；
   * 整体方向仍统一由 PAN_SIGN_* 管，与拖动那条链一致。
   */
  _stepByArc(right, forward) {    const target = this._controls.target;
    const offset = this._camera.position.clone().sub(target);
    const distance = offset.length();
    const elevation = Math.PI / 2 - target.clone().normalize().angleTo(offset);
    const { forward: axisForward, left: axisSide } = this._screenTangentFrame(target);

    const aboutForward = new THREE.Quaternion().setFromAxisAngle(axisForward, -PAN_SIGN_SIDE * right);
    const aboutRight = new THREE.Quaternion().setFromAxisAngle(axisSide, PAN_SIGN_FORWARD * forward);
    const turn = aboutForward.clone().multiply(aboutRight);
    const next = target.clone().applyQuaternion(turn).setLength(PLANET_RADIUS);
    this._placeCamera(next, offset.clone().applyQuaternion(turn), elevation, distance);
  }

  /**
   * 绕观察点转视角（同游戏 PlanetPoser）: 竖直轴 = 观察点当地法线、水平轴 = 竖直轴 × 视线。
   * 仰角最后夹到允许区间（下限随距离变）；贴着上/下限时水平分量照常生效，不会卡死。
   */
  _rotateByPixels(dx, dy) {
    const target = this._controls.target;
    const normal = target.clone().normalize();
    const offset = this._camera.position.clone().sub(target);
    const { vertical, pitchAxis } = this._rotationAxes(offset);
    if (!pitchAxis) return;

    const scale = (Math.PI * 2 / (this._canvas?.clientHeight || 1))
      * rotationSpeedForDistance(offset.length());
    const yaw = new THREE.Quaternion().setFromAxisAngle(vertical, dx * scale * DRAG_YAW_SIGN);
    const pitch = new THREE.Quaternion().setFromAxisAngle(pitchAxis, dy * scale * DRAG_PITCH_SIGN);
    const rotated = offset.clone().applyQuaternion(yaw.clone().multiply(pitch));

    // 近处一帧能转好几度，仰角在这里夹进允许区间
    const clamped = this._clampElevation(this._elevationOf(rotated, normal), offset.length());
    this._placeCamera(target, rotated, clamped, offset.length());
  }

  /**
   * 左键拖动: 把观察点挪到球面别处（相机跟着走）。左右拖绕 `forward`、上下拖绕 `left`（= 法线 × forward）;
   * 两个轴与每像素斜率在按下那一刻定死（每帧重算就不是测地线了）；仰角保持拖动前的值。
   * 「跟手」语义走像素 → 斜率，与键盘那条弧长链分开（见 _moveByKeys）。
   */
  _panByPixels(dx, dy) {
    const target = this._controls.target;
    const offset = this._camera.position.clone().sub(target);
    const distance = offset.length();                          // 当前取景距离（滚轮定的，拖动不变）
    const elevation = Math.PI / 2 - target.clone().normalize().angleTo(offset);

    // 优先用按下那一刻冻结的轴与斜率；没有（拖动被中断 / 脚本直调）才现算
    let axisForward = this._dragAxisForward;
    let axisSide = this._dragAxisSide;
    let rateSide = this._dragRateSide;
    let rateForward = this._dragRateForward;
    if (!axisForward || !axisSide || !(rateSide > 0) || !(rateForward > 0)) {
      const frame = this._screenTangentFrame(target);
      const probe = this._dragProbe ?? this._canvasCenterProbe();
      const rates = this._tangentRates(frame.forward, frame.left, probe);
      axisForward = frame.forward;
      axisSide = frame.left;
      rateSide = rates.rateSide / PAN_SENSITIVITY;
      rateForward = rates.rateForward / PAN_SENSITIVITY;
    }
    if (!(rateSide > 0) || !(rateForward > 0)) return;

    const aboutForward = new THREE.Quaternion().setFromAxisAngle(
      axisForward, -PAN_SIGN_SIDE * dx / rateSide,
    );
    const aboutRight = new THREE.Quaternion().setFromAxisAngle(
      axisSide, PAN_SIGN_FORWARD * dy / rateForward,
    );
    const turn = aboutForward.clone().multiply(aboutRight);
    const next = target.clone().applyQuaternion(turn).setLength(PLANET_RADIUS);
    this._placeCamera(next, offset.clone().applyQuaternion(turn), elevation, distance);
  }

  /**
   * 观察点当地切平面内的两个正交方向: `forward` = 视线的切向分量（屏幕"上"）、
   * `left` = 法线 × forward（屏幕右是 forward × 法线）。只在按下左键那一刻调一次，整段拖动沿用。
   */
  _screenTangentFrame(target) {
    const normal = target.clone().normalize();
    const view = this._camera.position.clone().sub(target).multiplyScalar(-1);
    const forward = view.clone().addScaledVector(normal, -view.dot(normal));
    // 相机正对法线时视线没有切向分量，退回当地正北（极点再退到 0° 经线那侧）
    if (forward.lengthSq() < 1e-12) {
      forward.copy(northDirection(
        Math.asin(THREE.MathUtils.clamp(normal.y, -1, 1)) / DEG,
        Math.atan2(normal.x, normal.z) / DEG,
      ));
    }
    forward.normalize();
    const left = new THREE.Vector3().crossVectors(normal, forward);
    return { forward, left };
  }

  /** 光标下的地表点（画布坐标 → NDC → 与行星球求交），没打中返回 null */
  _surfaceUnder(clientX, clientY) {
    const canvas = this._canvas;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect?.();
    const width = rect?.width || canvas.clientWidth || 1;
    const height = rect?.height || canvas.clientHeight || 1;
    if (!this._probeRay) this._probeRay = new THREE.Raycaster();
    if (!this._probeSphere) this._probeSphere = new THREE.Sphere(new THREE.Vector3(), PLANET_RADIUS);
    this._probeRay.setFromCamera(new THREE.Vector2(
      ((clientX - (rect?.left ?? 0)) / width) * 2 - 1,
      1 - ((clientY - (rect?.top ?? 0)) / height) * 2,
    ), this._camera);
    const hit = new THREE.Vector3();
    return this._probeRay.ray.intersectSphere(this._probeSphere, hit) ? hit : null;
  }

  /** 地表点的入射角 |法线 · 视线|（0 = 贴着地平线的掠射） */
  _incidenceAt(point) {
    return Math.abs(point.clone().normalize().dot(
      point.clone().sub(this._camera.position).normalize(),
    ));
  }

  /**
   * 量拖动斜率用的探针: 取光标下的地表点；它在天空里或太掠射时，沿中轴下部另找一片入射角够正的
   * 地面（低仰角下地平线就在屏幕中心，掠射点的斜率会塌掉，见 PROBE_MIN_INCIDENCE）。
   */
  _dragProbeAt(clientX, clientY) {
    const hit = this._surfaceUnder(clientX, clientY);
    if (hit && this._incidenceAt(hit) >= PROBE_MIN_INCIDENCE) return hit;
    const canvas = this._canvas;
    const rect = canvas?.getBoundingClientRect?.();
    const left = rect?.left ?? 0;
    const top = rect?.top ?? 0;
    const width = rect?.width || canvas?.clientWidth || 1;
    const height = rect?.height || canvas?.clientHeight || 1;
    for (let y = height * 0.7; y <= height; y += height * 0.1) {
      const fallback = this._surfaceUnder(left + width * 0.5, top + y);
      if (fallback && this._incidenceAt(fallback) >= PROBE_MIN_INCIDENCE) return fallback;
    }
    return this._controls.target.clone();
  }

  /** 画布中心那片地的探针（没有光标位置可用时的兜底） */
  _canvasCenterProbe() {
    const canvas = this._canvas;
    const rect = canvas?.getBoundingClientRect?.();
    const width = rect?.width || canvas?.clientWidth || 1;
    const height = rect?.height || canvas?.clientHeight || 1;
    return this._dragProbeAt((rect?.left ?? 0) + width * 0.5, (rect?.top ?? 0) + height * 0.5);
  }

  /**
   * 「拖动 1 像素，观察点要转多少弧度」的斜率（像素 / 弧度），两轴**一次量完**: 绕 axisForward /
   * axisSide 刚性转，量 `probe` 的屏幕位移；以当前位姿为基准每轴只量 +δ 一次，量完还原。
   * @returns {{rateSide: number, rateForward: number}} 绕 axisForward 的侧向斜率 / 绕 axisSide 的前后斜率
   */
  _tangentRates(axisForward, axisSide, probe) {
    const camera = this._camera;
    const target = this._controls.target;
    const offset = camera.position.clone().sub(target);
    const keepPosition = camera.position.clone();
    const keepUp = camera.up.clone();
    const keepQuaternion = camera.quaternion.clone();
    const halfWidth = (this._canvas?.clientWidth || 1) * 0.5;
    const halfHeight = (this._canvas?.clientHeight || 1) * 0.5;
    const delta = 1e-5;   // 单侧差分误差 O(δ)，步长再小一档（仍远大于浮点噪声）
    /** 绕 `axis` 转 `angle` 之后，`probe` 落在屏幕的哪个像素上 */
    const measure = (axis, angle) => {
      const turn = new THREE.Quaternion().setFromAxisAngle(axis, angle);
      const rotated = target.clone().applyQuaternion(turn).setLength(PLANET_RADIUS);
      camera.position.copy(rotated).add(offset.clone().applyQuaternion(turn));
      camera.up.copy(rotated.clone().normalize());
      camera.lookAt(rotated);
      camera.updateMatrixWorld(true);
      const point = probe.clone().project(camera);
      return new THREE.Vector2(point.x * halfWidth, point.y * halfHeight);
    };
    const base = measure(axisForward, 0);
    const rateSide = measure(axisForward, delta).distanceTo(base) / delta;
    const rateForward = measure(axisSide, delta).distanceTo(base) / delta;
    camera.position.copy(keepPosition);
    camera.up.copy(keepUp);
    camera.quaternion.copy(keepQuaternion);
    // 位姿还回去了，派生矩阵也要跟着还回去: 量斜率时 measure() 会把 matrixWorld 更新到临时位姿上，
    // 不重算的话，这一帧里随后用相机做的投影 / 射线（拾取）都会按临时位姿算。
    camera.updateMatrixWorld(true);
    return { rateSide, rateForward };
  }

  /** 按观察点、切向方位与仰角算出相机偏移（`_placeCamera` 里那份构造的只读版本） */
  _offsetFor(target, direction, elevationRad, distance) {
    const normal = target.clone().normalize();
    const tangent = direction.clone().addScaledVector(normal, -direction.dot(normal));
    if (tangent.lengthSq() < 1e-18) tangent.copy(normal).cross(new THREE.Vector3(1, 0, 0));
    const no = Math.sin(elevationRad) * distance;
    const scale = Math.sqrt(Math.max(0, distance * distance - no * no)) / tangent.length();
    return tangent.multiplyScalar(scale).addScaledVector(normal, no);
  }

  /** 相机相对观察点当地地平面的仰角 */
  _elevationOf(offset, normal) {
    return Math.PI / 2 - normal.angleTo(offset);
  }

  /**
   * 拖动旋转用的两个轴: 竖直轴 = `_pivotNormal`（观察点当地法线）；水平轴 = 竖直轴 × 视线。
   * 两者平行时换兜底轴（世界 +Y，再不行屏幕右方向），免得零向量让拖动失效。
   */
  _rotationAxes(offset) {
    const direction = offset.clone().normalize();
    const vertical = this._pivotNormal.clone();
    let pitchAxis = new THREE.Vector3().crossVectors(vertical, direction);
    if (pitchAxis.lengthSq() < 1e-8) pitchAxis = new THREE.Vector3().crossVectors(UP, direction);
    if (pitchAxis.lengthSq() < 1e-8) {
      pitchAxis = SCREEN_RIGHT.clone().applyQuaternion(this._camera.quaternion);
    }
    if (pitchAxis.lengthSq() < 1e-8) return { vertical, pitchAxis: null };
    return { vertical, pitchAxis: pitchAxis.normalize() };
  }

  dispose() {
    this._moveKeys = null;
    this.endDrag();
    this._clicked = false;
    this._controls?.dispose();
    this._controls = null;
    this._camera = null;
    this._canvas = null;
    this._pivotNormal = null;
    this._probeRay = null;
    this._probeSphere = null;
    this._dirty = false;
  }
}

export { CameraRig };
