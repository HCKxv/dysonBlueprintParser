/**
 * FactoryPreview — 工厂蓝图 3D 预览
 *
 * 场景约定与其它预览层一致: 行星半径 = 1、球心在原点，游戏局部坐标 z 取反（纬度 0°、经度 0° 在 +Z 一侧）。
 * 建筑落点见 lib/factory/blueprintLayout.js。**相机与操作不在这个文件里** —— 机位数学在
 * lib/factory/cameraRig.js，坐标与单位换算在 lib/factory/planetFrames.js；
 * 本文件只管场景与蓝图、事件分发、拾取与图层开关。
 *
 * 操作: 左键拖动 / **W/A/S/D** 让观察点在球面上走、左键**点**建筑选中并高亮（再点同一栋或点空处取消）、
 *       中键拖动转视角、滚轮缩放；右键不接管。
 *
 * 用法: init(canvas) / setBlueprint(data, resetView)（null = 清空）/ setGridVisible(visible) /
 *       setLayerVisible('buildings'|'belts'|'inserters'|'icons', visible) / setTargetLatitude(lat, north) /
 *       setSelectionListener(fn) / selectBuilding(index) / resetView() / resize() / dispose()
 */

import * as THREE from 'three';
import { createPlanetGrid, DEFAULT_PLANET_RADIUS } from '../grid/planetGrid.js';
import {
  buildPlanetGridLines,
  PLANET_FINE_GRID_MAX_DISTANCE,
} from '../grid/planetGridMesh.js';
import {
  ALTITUDE_STEP_SCENE, CELL_SCENE, DEG, GAME_UNIT_SCENE, PLANET_RADIUS, flipZ, northDirection,
  surfaceDirection,
} from './planetFrames.js';
import { CameraRig, CAMERA_FOV_DEG } from './cameraRig.js';
import { isAssembler, isBelt, isInserter, isLab, LOGISTIC_ROLE_COLORS } from '../blueprint/factory/factoryItems.js';
import { layoutBlueprint } from './blueprintLayout.js';
import { createStarfield, disposeStarfield, STARFIELD_BG_COLOR } from '../preview/starfield.js';
import {
  buildingModel, BUILDING_MODELS,
  BELT_FORWARD_LOCAL, BELT_LINK, BELT_LINK_PRISM, BELT_OCTAGON_PRISM, BELT_SIZE,
  INSERTER_ARROW, INSERTER_MODEL, INSERTER_PARTS,
} from './buildingModels.js';
import { itemIconUrl } from '../markup/itemIcons';

/** 行星球体的经纬分段数（512×256 时面片中心凹陷 1 − cos(π/分段数) ≈ 7.5e-5） */
const PLANET_SPHERE_SEGMENTS = { width: 512, height: 256 };

/** 网格线相对球面的抬高: 必须大于球面多边形的下陷（见上），否则面片会从线里穿出来 */
const GRID_RADIUS_SCALE = 1.0001;

/** 绘制顺序: 粗线在细线之后（交叉处由粗线压住），赤道线最后 */
const GRID_LINE_RENDER_ORDER = 2;
const GRID_LINE_MAJOR_RENDER_ORDER = 3;
const GRID_LINE_EQUATOR_RENDER_ORDER = 4;

const GRID_LINE_OPACITY = 0.18;
const GRID_LINE_MAJOR_OPACITY = 0.3;
/** 赤道线比粗线再亮一档 */
const GRID_LINE_EQUATOR_OPACITY = 0.25;

const PLANET_COLOR = 0x39404b;

/** 本工具的星空种子 */
const STARFIELD_SEED = 20260307;

/** 默认视角（没打开蓝图时）: 观察点 = 赤道 0° 经线，视线朝当地正北、仰角 60°（机位由 cameraRig 摆） */
const DEFAULT_HOME_VIEW = { latDeg: 0, lngDeg: 0, distance: 0.5, elevationRad: 60 * DEG };

/**
 * 打开蓝图后的机位仰角（游戏主视角默认俯角 30°）: 必须 < 90°，否则相机正对法线
 * （极角 = 0）时水平拖动会退化成绕视线原地滚转，而不是绕当地竖直轴转。
 */
const HOME_ELEVATION_RAD = 60 * DEG;

/** 选中高亮的**参数表**（画法见 _showHighlight / _addShells） */
const HIGHLIGHT = {
  color: 0x66ff7f,          // 填充颜色
  fillOpacity: 0.1,         // 填充透明度（混合方式见 fillBlend）
  renderOrder: 20,          // 绘制顺序（画在建筑之后；图标比它更晚，见 ICON_RENDER_ORDER）
  grow: 0.05,              // 壳每个面往外长多少（游戏世界单位；一格 = 6.3 世界单位），与建筑大小无关
  fillBlend: {
    // **取较亮的一方（max）**，不是相加 —— 高亮盒子彼此重叠，相加会在重叠处叠出更亮的块
    blending: THREE.CustomBlending,
    blendEquation: THREE.MaxEquation,        // 颜色: max(源, 场景)，只提亮不压暗
    blendSrc: THREE.SrcAlphaFactor,          // 源 = 源色 × 不透明度
    blendDst: THREE.OneFactor,               // 目标 = 场景
    blendEquationAlpha: THREE.MaxEquation,   // alpha 通道同样取较亮
    blendSrcAlpha: THREE.OneFactor,          // alpha 通道的源系数（按原样过）
    blendDstAlpha: THREE.OneFactor,          // alpha 通道的目标系数
  },
  belt: {
    // 传送带整条线那套: 更淡更灰，壳比带子稍微大一圈
    color: 0xa3c2a8,        // 线色
    fillOpacity: 0.05,      // = 普通填充的一半
    grow: 0.01,             // 每个面往外长多少（游戏世界单位）
  },
};

/** 连接箭头的单位几何（形状见 buildingModels.js 的 BELT_LINK_PRISM）; 画与高亮共用，缓存的不要 dispose */
let unitPrismCache = null;
function unitPrism() {
  if (!unitPrismCache) {
    unitPrismCache = new THREE.BufferGeometry();
    unitPrismCache.setAttribute('position', new THREE.Float32BufferAttribute(BELT_LINK_PRISM.positions, 3));
    unitPrismCache.setIndex(BELT_LINK_PRISM.index);
    unitPrismCache.computeVertexNormals();
  }
  return unitPrismCache;
}

/** 传送带本体几何（形状 BELT_OCTAGON_PRISM、尺寸 BELT_SIZE）: 正八棱柱，尺寸烘进几何、底面贴在落点上。 */
let beltGeometryCache = null;
function beltGeometry() {
  if (!beltGeometryCache) {
    beltGeometryCache = new THREE.BufferGeometry();
    beltGeometryCache.setAttribute('position', new THREE.Float32BufferAttribute(BELT_OCTAGON_PRISM.positions, 3));
    beltGeometryCache.setAttribute('normal', new THREE.Float32BufferAttribute(BELT_OCTAGON_PRISM.normals, 3));
    beltGeometryCache.setIndex(BELT_OCTAGON_PRISM.index);
    beltGeometryCache.scale(
      BELT_SIZE.width * GAME_UNIT_SCENE,
      BELT_SIZE.height * GAME_UNIT_SCENE,
      BELT_SIZE.depth * GAME_UNIT_SCENE,
    );
    beltGeometryCache.translate(0, BELT_SIZE.height * GAME_UNIT_SCENE * 0.5, 0);   // 底面贴地
  }
  return beltGeometryCache;      // 共用这份，各网格 clone() 一份自己的（见 _addBelts），别 dispose 它
}

/** 带子本体相对落点抬多高（底面贴地 = 半个高）: 摆带子与高亮壳共用 */
const BELT_BASE_LIFT = BELT_SIZE.height * GAME_UNIT_SCENE * 0.5;

/** 传送带模型的「前方」在本地是 +Z（数据见 buildingModels.js）；主输入判定要用，见 _beltLinks */
const BELT_FORWARD = new THREE.Vector3().fromArray(BELT_FORWARD_LOCAL);
/**
 * 主输入判定的角度门槛（度）: 输入方向与「前方」夹角 ≥ 它才算从后面接过来（正后方 180°、侧向 90°）；
 * 两条候选都在后方且互相夹角也 ≥ 它 → 没有主输入。与游戏 CargoTraffic 里的 120f 同档。
 */
const BELT_MAIN_INPUT_MIN_ANGLE = 120;

/** 行星地基网格模型（只读，用来取行列 / 格数信息） */
const PLANET_GRID = createPlanetGrid(DEFAULT_PLANET_RADIUS);

/** 分拣器组件表（见 buildingModels.js 的 INSERTER_PARTS）换算成场景单位: 表里是游戏世界单位，这里一次折好 */
function inserterEndInScene(end) {
  const toScene = (values) => values.map((value) => value * GAME_UNIT_SCENE);
  return {
    inward: end.inward === true,
    hinge: toScene(end.hinge),
    parts: end.parts.map((part) => ({
      ...part,
      position: toScene(part.position),
      size: toScene(part.size),
    })),
  };
}

/** 传送带端 / 建筑端的组件表与爪臂截面（都已折成场景单位） */
const INSERTER_GATE = inserterEndInScene(INSERTER_PARTS.gate);
const INSERTER_BLOCK = inserterEndInScene(INSERTER_PARTS.block);
const INSERTER_ARM_SECTION = INSERTER_PARTS.arm.section * GAME_UNIT_SCENE;

/**
 * 图标的深度偏置: 只推深度（不是位置）。图标在建筑体内，开深度测试会被自己的前表面吃掉、
 * 关掉又会透出背面和地形，所以在顶点着色器里另算一份 z += bias 的 depthPosition，
 * 只取它的 NDC z 覆盖 gl_Position.z（xy / w 不动，屏幕位置与大小不变）。
 */
const ICON_DEPTH_BIAS_GAME_UNITS = 6;
const ICON_DEPTH_BIAS = ICON_DEPTH_BIAS_GAME_UNITS * GAME_UNIT_SCENE;

/** 场景里的「上」方向（方块要立在球面上: +Y 对准该点法线） */
const UP = new THREE.Vector3(0, 1, 0);

/**
 * 建筑朝向（Maths.SphericalRotation × BlueprintUtils.cs 的 LookRotation）: forward = 正北切线、
 * up = 地表法线，即模型 +Y 指法线、+Z 指正北，再绕局部 +Y 转 yaw。
 * 场景这边 z 与游戏相反、旋向随之翻转: 游戏里 yaw 90° 指向经度增大方向，这里要转 −90°。
 */
function buildingQuaternion(latDeg, lngDeg, yawDeg = 0) {
  const up = surfaceDirection(latDeg, lngDeg);
  const north = northDirection(latDeg, lngDeg);
  const xAxis = new THREE.Vector3().crossVectors(up, north).normalize();
  const zAxis = new THREE.Vector3().crossVectors(xAxis, up).normalize();
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(xAxis, up, zAxis),
  );
  if (yawDeg) {
    quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(UP, -yawDeg * DEG));
  }
  return quaternion;
}

/**
 * 分拣器某一端的朝向（两端各自独立）: lrot = SphericalRotation(dir, 0) × Euler(pitch, yaw − num×90, tilt)。
 * Unity 的 Euler 是「先 Z、再 X、最后 Y」= three 的 'YXZ'；本预览是右手系，三个角取负。
 */
function inserterEndQuaternion(building, end = false) {
  const lat = (end ? building.endLatDeg : building.latDeg) ?? 0;
  const lng = (end ? building.endLngDeg : building.lngDeg) ?? 0;
  const yaw = (end ? building.yaw2Deg : building.yawDeg) ?? 0;
  const pitch = (end ? building.pitch2Deg : building.pitchDeg) ?? 0;
  const tilt = (end ? building.tilt2Deg : building.tiltDeg) ?? 0;
  return buildingQuaternion(lat, lng, 0).multiply(
    new THREE.Quaternion().setFromEuler(new THREE.Euler(
      -pitch * DEG, -yaw * DEG, -tilt * DEG, 'YXZ',
    )),
  );
}

/** 建筑朝向: 分拣器走两端各自的角度（见 inserterEndQuaternion），其余建筑只绕局部 +Y 转 yaw */
function buildingOrientation(building) {
  if (!isInserter(building.itemId)) {
    return buildingQuaternion(building.latDeg, building.lngDeg, building.yawDeg ?? 0);
  }
  return inserterEndQuaternion(building, false);
}

/** 指示片贴图的长边像素数（另一边按 INSERTER_ARROW 的宽高比推） */
const INSERTER_ARROW_TEXTURE_LONG_SIDE = 80;

/** 焦点在输入框 / 下拉框 / 可编辑区里时，按键不归预览管（别抢 WASD） */
function isTypingTarget(element) {
  const tag = element?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element?.isContentEditable === true;
}

/**
 * 指示片贴图的画布尺寸: 宽高比跟着 INSERTER_ARROW.width : length 走 —— 片子是非等比缩放的，
 * 比例对不上 chevron 就会被拉扁；长边固定，短边按比例推。
 */
function inserterArrowTextureSize() {
  const scale = INSERTER_ARROW_TEXTURE_LONG_SIDE / Math.max(INSERTER_ARROW.width, INSERTER_ARROW.length);
  return {
    width: Math.max(1, Math.round(INSERTER_ARROW.width * scale)),
    height: Math.max(1, Math.round(INSERTER_ARROW.length * scale)),
  };
}

/** 爪臂方向指示片用的 chevron 贴图（尖端朝贴图 +V，画布见 inserterArrowTextureSize）；共用一份 */
let inserterArrowTexture = null;
function getInserterArrowTexture() {
  if (inserterArrowTexture) return inserterArrowTexture;
  const { width, height } = inserterArrowTextureSize();
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.strokeStyle = `#${INSERTER_ARROW.color.toString(16).padStart(6, '0')}`;
  ctx.lineWidth = height * 0.1;                       // 粗细按片子长度给，改尺寸不会变粗变细
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(width * 0.2, height * 0.66);
  ctx.lineTo(width * 0.5, height * 0.2);
  ctx.lineTo(width * 0.8, height * 0.66);
  ctx.stroke();
  inserterArrowTexture = new THREE.CanvasTexture(canvas);
  inserterArrowTexture.colorSpace = THREE.SRGBColorSpace;
  return inserterArrowTexture;
}

/**
 * 图标标签数字的写法（抄游戏 WriteKMG）: <10000 原样；再大按 1000 进制缩成 k/M/G/T/P/E，
 * 保留 3 位有效数字、多出的位截断（12345 → 12.3k、999999 → 999k、1000000 → 1.00M）。
 */
function formatCount(value) {
  const count = Math.max(0, Math.round(value));
  if (count < 10000) return String(count);
  const suffixes = ['k', 'M', 'G', 'T', 'P', 'E'];      // 第 i 档 = 10^(3×(i+1))
  let level = 0;
  while (level < suffixes.length - 1 && count >= 10 ** (3 * (level + 2))) level += 1;
  const scaled = count / 10 ** (3 * (level + 1));
  const decimals = Math.max(0, 3 - String(Math.trunc(scaled)).length);
  const factor = 10 ** decimals;
  return `${(Math.trunc(scaled * factor) / factor).toFixed(decimals)}${suffixes[level]}`;
}

/** 图标素材的原尺寸（正方形，px）—— 用的都是 80×80，画布不放缩 */
const ICON_TEXTURE_SIZE = 80;

/**
 * 图标 + 右下角数字合成一张纹理（传送带的图标标签: parameters.iconId + count）。
 * 画布就是图标的 80×80 —— 图标的大小与位置与没数字时完全一致，数字用描边字压在右下角。
 * count = 0 = 不显示数字，由调用方判断。
 *
 * @param {CanvasImageSource} image 已加载好的图标图片（80×80）
 * @param {number} count 压在右下角的数字（按 formatCount 缩写）
 */
function iconCountTexture(image, count) {
  const iconSize = ICON_TEXTURE_SIZE;                // 图标原尺寸，画布不再放大
  const canvas = document.createElement('canvas');
  canvas.width = iconSize;
  canvas.height = iconSize;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0, iconSize, iconSize);

  const text = formatCount(count);
  const fontSize = Math.round(iconSize * 0.24);
  const cornerX = iconSize - 2;                      // 右对齐 + 底对齐 = 贴着右下角
  const cornerY = iconSize - 1;
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.lineWidth = Math.max(3, fontSize * 0.26);      // 描边: 压在图标上也看得清
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
  ctx.strokeText(text, cornerX, cornerY);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, cornerX, cornerY);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/**
 * 图标 + 右下角建筑角标合成一张纹理（角标 = 图标的一半大，贴右下角内侧）
 */
function iconBadgeTexture(iconImage, badgeImage) {
  const BADGE_SCALE = 1 / 2;
  const badge = ICON_TEXTURE_SIZE * BADGE_SCALE;
  const canvas = document.createElement('canvas');
  canvas.width = ICON_TEXTURE_SIZE;
  canvas.height = ICON_TEXTURE_SIZE;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(iconImage, 0, 0, ICON_TEXTURE_SIZE, ICON_TEXTURE_SIZE);
  // 角标贴在右下角内侧: 左上角 = 图标右下角 − 整个角标
  ctx.drawImage(badgeImage, ICON_TEXTURE_SIZE - badge, ICON_TEXTURE_SIZE - badge, badge, badge);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

// ─── 物流塔的「塔内」卡片（物品栏） ──────────────────────────────
/**
 * 物品栏 → 卡片行（一个栏位一行）: 星际站本地在上、星际在下，行星内站只有本地，空栏位两个都是 null。
 * 只画 2103 / 2104。
 *
 * @returns {Array<{itemId: number, max: number, local: number|null, remote: number|null}>|null} 供需档 0 仓储 / 1 供应 / 2 需求
 */
function stationPanelSlots(building) {
  const STATION_PANEL_IDS = new Set([2103, 2104]);
  if (!STATION_PANEL_IDS.has(building?.itemId)) return null;
  const storage = building.parameters?.storage;
  if (!Array.isArray(storage) || !storage.length) return null;
  const stellar = Number(building.itemId) === 2104;
  return storage.map((row) => {
    const itemId = Number(row?.itemId ?? 0);
    if (!(itemId > 0)) return { itemId: 0, max: 0, local: null, remote: null };
    return {
      itemId,
      max: Number(row?.max ?? 0),
      local: Number(row?.localRole ?? 0),
      remote: stellar ? Number(row?.remoteRole ?? 0) : null,
    };
  });
}

/** 一支水平箭头: 箭尖在 headX、箭尾在 tailX */
function arrowPath(ctx, headX, tailX, midY, headLength, headHeight, shaftHeight) {
  const dir = headX <= tailX ? 1 : -1;
  ctx.beginPath();
  ctx.moveTo(headX, midY);
  ctx.lineTo(headX + dir * headLength, midY - headHeight / 2);
  ctx.lineTo(headX + dir * headLength, midY - shaftHeight / 2);
  ctx.lineTo(tailX, midY - shaftHeight / 2);
  ctx.lineTo(tailX, midY + shaftHeight / 2);
  ctx.lineTo(headX + dir * headLength, midY + shaftHeight / 2);
  ctx.lineTo(headX + dir * headLength, midY + headHeight / 2);
  ctx.closePath();
}

/**
 * 画一格的供需图标（x = 左边界、midY = 中线、size = 图标框边长）: 行星内站一个（居中），
 * 星际站本地小一档在上、星际在下，两个左对齐、整组居中（remoteRole = null = 行星内站）。
 */
function drawRoleGlyph(ctx, x, midY, size, localRole, remoteRole) {
  const LOCAL_SCALE = 0.7;        // 「本地」那个小一档
  const STACK_GAP = 4;            // 两个图标之间的缝
  const SLOT = 0.72;              // 每个图标的占位高
  const SPAN_TO = 0.8;           // 图形右缘（仓储长方形右边 / 箭头尖）距本格左缘的距离，按图标框边长算
  const BOX_HEIGHT = 0.68;        // 仓储长方形的高
  const BOX_STROKE = 0.07;        // 长方形描边宽
  const WALL_WIDTH = 0.14;        // 塔壁那条竖条的宽
  const WALL_GAP = 0.08;          // 塔壁与箭头之间的缝

  /** 画一个（左边界 left、中线 y） */
  const glyph = (left, y, s, role) => {
    const color = LOGISTIC_ROLE_COLORS[role] ?? LOGISTIC_ROLE_COLORS[0];
    const to = left + s * SPAN_TO;
    if (role === 0) {
      // 仓储: 长方形 + 一横（描边画在框内）
      const boxHeight = s * BOX_HEIGHT;
      const top = y - boxHeight / 2;
      const stroke = Math.max(2, s * BOX_STROKE);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
      ctx.fillRect(left, top, to - left, boxHeight);
      ctx.strokeStyle = color;
      ctx.lineWidth = stroke;
      ctx.strokeRect(left + stroke / 2, top + stroke / 2, to - left - stroke, boxHeight - stroke);
      ctx.fillStyle = color;
      const barWidth = (to - left) * 0.56;
      const barHeight = Math.max(4, boxHeight * 0.22);
      ctx.fillRect(left + (to - left - barWidth) / 2, y - barHeight / 2, barWidth, barHeight);
      return;
    }
    // 塔壁（左边的竖条）+ 箭头
    ctx.fillStyle = color;
    ctx.fillRect(left, y - s * 0.36, s * WALL_WIDTH, s * 0.72);
    const nearX = left + s * (WALL_WIDTH + WALL_GAP);   // 靠塔壁那一头
    if (role === 1) arrowPath(ctx, to, nearX, y, s * 0.24, s * 0.46, s * 0.16);
    else arrowPath(ctx, nearX, to, y, s * 0.24, s * 0.46, s * 0.16);
    ctx.fill();
  };

  if (remoteRole === null) {
    glyph(x, midY, size, localRole);
    return;
  }
  // 整组在格里居中；两个左对齐
  const localSize = Math.round(size * LOCAL_SCALE);
  const localSlot = localSize * SLOT;
  const remoteSlot = size * SLOT;
  const top = midY - (localSlot + STACK_GAP + remoteSlot) / 2;
  glyph(x, top + localSlot / 2, localSize, localRole);
  glyph(x, top + localSlot + STACK_GAP + remoteSlot / 2, size, remoteRole);
}

/** 画一张「塔内」卡片: 半透明底 + 左边物品图标 + 每行「上限 + 一格供需」 */
function stationPanelTexture(slots, images) {
  const ROW_HEIGHT = 96;          // 一行 = 一个栏位
  const PAD = 14;
  const ICON_SIZE = 80;
  const ICON_GAP = 12;
  const NUMBER_WIDTH = 176;
  const NUMBER_FONT = 52;
  const GLYPH_GAP = 28;
  const GLYPH_SIZE = 44;          // 供需图标框边长（= 这一列宽）

  const width = PAD * 2 + ICON_SIZE + ICON_GAP + NUMBER_WIDTH + GLYPH_GAP + GLYPH_SIZE;
  const height = PAD * 2 + slots.length * ROW_HEIGHT;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = 'rgba(38, 42, 50, 0.7)';
  ctx.fillRect(0, 0, width, height);

  const iconX = PAD;
  const numberRight = iconX + ICON_SIZE + ICON_GAP + NUMBER_WIDTH;   // 数字右对齐
  const glyphX = numberRight + GLYPH_GAP;
  ctx.font = `bold ${NUMBER_FONT}px sans-serif`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';

  let top = PAD;
  for (const slot of slots) {
    const midY = top + ROW_HEIGHT / 2;
    const image = images.get(slot.itemId);
    if (image) {
      ctx.drawImage(image, iconX, midY - ICON_SIZE / 2, ICON_SIZE, ICON_SIZE);
    }
    if (slot.local === null && slot.remote === null) {
      // 空栏位: 数字那一列一条横杠
      ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.fillRect(numberRight - NUMBER_WIDTH * 0.4, midY - 3, NUMBER_WIDTH * 0.4, 6);
      top += ROW_HEIGHT;
      continue;
    }
    // 上限，颜色按星际那一档（行星内站按本地）
    ctx.fillStyle = LOGISTIC_ROLE_COLORS[slot.remote ?? slot.local] ?? LOGISTIC_ROLE_COLORS[0];
    ctx.fillText(String(slot.max), numberRight, midY);
    drawRoleGlyph(ctx, glyphX, midY, GLYPH_SIZE, slot.local, slot.remote);
    top += ROW_HEIGHT;
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;   // 同图标: 不声明会被当成线性数据、颜色发灰
  texture.anisotropy = 4;
  return texture;
}

/**
 * 给图标材质打补丁: 把参与深度测试的 z 朝相机推近 bias（xy / w 不动，屏幕位置与大小不变）。
 *
 * @param {THREE.SpriteMaterial} material
 * @param {number} bias       偏置（场景单位）
 * @param {number} nearPlane  近裁剪面距离，偏置的上限由它兜底
 */
function applyIconDepthBias(material, bias, nearPlane) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.iconDepthBias = { value: bias };
    shader.uniforms.iconNearPlane = { value: nearPlane };
    shader.vertexShader = `
uniform float iconDepthBias;
uniform float iconNearPlane;
` + shader.vertexShader.replace(
      'gl_Position = projectionMatrix * mvPosition;',
      `
	float iconBias = min( iconDepthBias, max( 0.0, - mvPosition.z - iconNearPlane ) );
	vec4 iconDepthPosition = mvPosition;
	iconDepthPosition.z += iconBias;
	vec4 iconDepthClip = projectionMatrix * iconDepthPosition;
	gl_Position = projectionMatrix * mvPosition;
	gl_Position.z = iconDepthClip.z / iconDepthClip.w * gl_Position.w;`,
    );
  };
  return material;
}

/** 图标 sprite 的材质（主图标 / 数字版 / 角标版共用）: UI 素材不参与色调映射，再打上深度偏置补丁 */
function iconSpriteMaterial(map, nearPlane) {
  return applyIconDepthBias(new THREE.SpriteMaterial({
    map,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    sizeAttenuation: true,
    toneMapped: false,
  }), ICON_DEPTH_BIAS, nearPlane);
}

/**
 * 图标绘制顺序: 必须晚于高亮 —— 高亮关掉了深度测试（见 HIGHLIGHT），图标要是先画就会被它糊上一层。
 */
const ICON_RENDER_ORDER = HIGHLIGHT.renderOrder + 10;

/** 往图标层摆一个 sprite（清单条目见 _addIcons / _addStationPanels）: 位置与尺寸直接取自清单，材质由调用方选好 */
function addIconSprite(group, item, material) {
  const sprite = new THREE.Sprite(material);
  sprite.name = item.name ?? 'factory-icon';
  sprite.renderOrder = ICON_RENDER_ORDER;
  sprite.position.copy(item.position);
  // 方形图标给边长（scale）、物流塔卡片给宽高（size，按贴图比例）
  if (item.size) sprite.scale.set(item.size[0], item.size[1], 1);
  else sprite.scale.set(item.scale, item.scale, 1);
  group.add(sprite);
}

/** 未知建筑方块的棋盘贴图: 2×2 格 */
let unknownCubeTextureCache = null;
function unknownCubeTexture() {
  if (!unknownCubeTextureCache) {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;
    const ctx = canvas.getContext('2d');
    const colors = [
      ['#000000', '#FFD400'],       // 上排: 黑 黄
      ['#FFD400', '#000000'],       // 下排: 黄 黑
    ];
    for (let y = 0; y < 2; y += 1) {
      for (let x = 0; x < 2; x += 1) {
        ctx.fillStyle = colors[y][x];
        ctx.fillRect(x, y, 1, 1);
      }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;   // 同图标: 不声明会被当成线性数据、颜色发灰
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    unknownCubeTextureCache = texture;
  }
  return unknownCubeTextureCache;
}

/** 未知建筑方块（1 格立方体，表面 2×2 黑黄棋盘）的几何) */
let unknownCubeGeometryCache = null;
function unknownCubeGeometry() {
  if (!unknownCubeGeometryCache) {
    unknownCubeGeometryCache = new THREE.BoxGeometry(CELL_SCENE, CELL_SCENE, CELL_SCENE);
  }
  return unknownCubeGeometryCache;
}

/**
 * 可独立开关的显示层（预览下方状态行里的一排按钮）
 *   建筑 / 传送带 / 分拣器按建筑归属；图标 = 建筑头顶的图标（物流塔是它的「塔内」物品栏卡片）
 */
const LAYERS = ['buildings', 'belts', 'inserters', 'icons'];

class FactoryPreview {
  constructor() {
    this._renderer = null;
    this._canvas = null;
    this._scene = null;
    this._camera = null;
    /** 相机与操作（贴地表面行走那套）: 机位数学全在它里面，见 lib/factory/cameraRig.js */
    this._rig = null;
    this._planet = null;
    this._keyLight = null;
    this._starfield = null;
    this._gridLines = null;
    this._gridLinesMajor = null;
    this._gridLinesEquator = null;
    this._markers = null;
    /** 视角「归位」的目标: 打开蓝图后是蓝图中心，没蓝图时是赤道（交给 rig，见 _applyHomeView） */
    this._homeView = { ...DEFAULT_HOME_VIEW };
    /** 目标纬度（度）: 多区域蓝图优先吸附到离它最近的位置；null = 自动（北半球、低纬度） */
    this._targetLatDeg = null;
    /** 目标半球（true 北 / false 南），纬度 0 时用来区分「北 0°」和「南 0°」 */
    this._targetNorth = null;
    /** 当前打开的蓝图（改目标纬度时要重算落点） */
    this._blueprint = null;
    /** 网格线开关（细线还要再按相机距离判断一次） */
    this._gridVisible = true;
    /** 各显示层的开关（见 LAYERS） */
    this._layers = { buildings: true, belts: true, inserters: true, icons: true };
    /** 各显示层对应的场景 Group（层与 Group 一一对应，别再加 `_inserters` 之类别名，会失同步） */
    this._layerGroups = { buildings: null, belts: null, inserters: null, icons: null };
    /** 建筑全表（下标 = 建筑序号，空位 null；setBlueprint 时摆一次，见 _buildBlueprintObjects） */
    this._allBuildings = [];
    /** 选中的建筑: 只留编号，建筑记录一概不留 */
    this._selectedIndex = null;
    /** 选中变化的回调（见 setSelectionListener） */
    this._selectionListener = null;
    /** 高亮组（见 _showHighlight） */
    this._highlight = null;
    /** 拾取用的射线（点击用） */
    this._pickRay = null;
    /** 按住的方向键（W/A/S/D）: 这个文件只管记，走动由 rig 在渲染循环里按帧长算 */
    this._moveKeys = new Set();
    this._lastTickTime = 0;
    /** 脏标记: 交互 / 场景变化时置位，静止时跳过渲染（省电；相机那一路由 rig.tick 报） */
    this._needsRender = true;
    this._frameId = null;
    this._resizeObserver = null;
    /** 主光相对相机的偏移（相机空间: 偏右上一点，球面才有明暗过渡） */
    this._lightOffset = new THREE.Vector3(0.4, 0.55, 0);
  }

  // ─── 初始化 ─────────────────────────────────────────────────
  /** 初始化场景; canvas 尺寸由 CSS 决定，这里只跟 CSS 对齐 */
  init(canvas) {
    if (this._renderer) this.dispose();

    this._canvas = canvas;
    this._scene = new THREE.Scene();
    this._scene.background = new THREE.Color(STARFIELD_BG_COLOR);   // 星空背景，与球体预览同款

    this._camera = new THREE.PerspectiveCamera(CAMERA_FOV_DEG, 1, 0.05, 100);
    // 具体位置由 _applyHomeView() 交给 rig 摆（默认正视赤道、本初子午线）

    this._renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // 尺寸与相机 aspect 一次对齐（取景按真实宽高比算）
    this.resize();
    this._renderer.outputColorSpace = THREE.SRGBColorSpace;

    this._starfield = createStarfield(this._renderer.getPixelRatio(), STARFIELD_SEED);
    this._scene.add(this._starfield);

    // 相机与操作: 滚轮缩放、阻尼、中键转视角、左键挪观察点全在 rig 里（见 cameraRig.js 的文件头）
    this._rig = new CameraRig();
    this._rig.attach(canvas, this._camera);
    this._rig.setMoveKeys(this._moveKeys);

    // 左键 / 中键拖动: 按下在画布上，移动/抬起挂到 window，拖出面板也不会断
    // （按下与拖动直接交给 rig；抬起还要接拾取，见 _onPointerUp）
    this._pointerHandlers = {
      down: (event) => this._rig?.beginPointer(event),
      move: (event) => this._rig?.movePointer(event),
      up: (event) => this._onPointerUp(event),
    };
    canvas.addEventListener('pointerdown', this._pointerHandlers.down);
    window.addEventListener('pointermove', this._pointerHandlers.move);
    window.addEventListener('pointerup', this._pointerHandlers.up);
    window.addEventListener('pointercancel', this._pointerHandlers.up);

    // W/A/S/D 挪观察点: 挂 window（画布不聚焦），失焦清键位
    this._keyHandlers = {
      down: (event) => this._onKeyDown(event),
      up: (event) => this._onKeyUp(event),
      blur: () => this._moveKeys.clear(),
    };
    window.addEventListener('keydown', this._keyHandlers.down);
    window.addEventListener('keyup', this._keyHandlers.up);
    window.addEventListener('blur', this._keyHandlers.blur);

    // 行星本体: 深灰色球体，明暗全靠一盏跟着相机的主光
    this._planet = new THREE.Mesh(
      new THREE.SphereGeometry(PLANET_RADIUS, PLANET_SPHERE_SEGMENTS.width, PLANET_SPHERE_SEGMENTS.height),
      new THREE.MeshStandardMaterial({ color: PLANET_COLOR, roughness: 0.95, metalness: 0 }),
    );
    this._scene.add(this._planet);

    this._keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
    this._scene.add(this._keyLight);
    this._scene.add(new THREE.AmbientLight(0x93a7c8, 0.5));

    this._addGridLines();

    this._resizeObserver = new ResizeObserver(() => this.resize());
    this._resizeObserver.observe(canvas.parentElement || canvas);

    this._applyHomeView();
    this._updateGridVisibility();
    this._startLoop();
  }

  // ─── 地基网格线 ─────────────────────────────────────────────
  /** 建粗 / 细两级网格线（粗线是细线的子集，共用一份顶点），赤道线再单独一档 */
  _addGridLines() {
    const lines = buildPlanetGridLines(PLANET_GRID);
    const vertices = new THREE.Float32BufferAttribute(flipZ(lines.positions), 3);

    this._gridLines = this._addLines(
      lines.lineIndices, vertices, GRID_LINE_OPACITY, GRID_LINE_RENDER_ORDER,
    );
    this._gridLinesMajor = this._addLines(
      lines.lineIndicesMajor, vertices, GRID_LINE_MAJOR_OPACITY, GRID_LINE_MAJOR_RENDER_ORDER,
    );
    this._gridLinesEquator = this._addLines(
      lines.lineIndicesEquator, vertices, GRID_LINE_EQUATOR_OPACITY, GRID_LINE_EQUATOR_RENDER_ORDER,
    );
  }

  /** 加一组线段到场景里 */
  _addLines(indices, positionAttribute, opacity, renderOrder) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', positionAttribute);
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    const material = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity,
      // 透明叠加层不写深度: 线与线交叠时不会互相挡，背面仍由球体的深度挡掉
      depthWrite: false,
    });
    const lineSegments = new THREE.LineSegments(geometry, material);
    lineSegments.scale.setScalar(GRID_RADIUS_SCALE);
    lineSegments.renderOrder = renderOrder;
    this._scene.add(lineSegments);
    return lineSegments;
  }

  // ─── 蓝图建筑 ───────────────────────────────────────────────
  /**
   * 摆出蓝图里的建筑（落点见 lib/factory/blueprintLayout.js），依次构建四个图层。
   * 每次摆都清空选中: 编号是蓝图内部序号，不能留给下一份蓝图。
   *
   * @param {object|null} blueprint factoryParser 的解析结果；null = 清空
   * @param {boolean} [resetView] 视角是否归位
   */
  setBlueprint(blueprint, resetView = true) {
    this._clearBlueprintObjects();
    if (resetView) this._homeView = { ...DEFAULT_HOME_VIEW };   // 归位目标: 没蓝图就是赤道 0° 经线（见 DEFAULT_HOME_VIEW）
    this._blueprint = blueprint ?? null;
    if (!this._scene || !blueprint) {
      this._selectBuilding(null);                // 蓝图没了，选中也就没了（会通知回调）
      this._applyLayers();
      if (resetView) this._applyHomeView();
      return;
    }

    const layout = layoutBlueprint(blueprint, {
      targetLatDeg: this._targetLatDeg,
      targetNorth: this._targetNorth ?? undefined,
    });
    this._buildBlueprintObjects(layout);

    this._addMarkers(layout, Math.min(Math.max(blueprint.primaryAreaIdx ?? 0, 0), layout.areas.length - 1));

    // 归位目标按新蓝图重算（「复位视角」据此回蓝图中心），只是不一定要马上把镜头挪过去
    if (layout.focus) {
      const focus = layout.focus;
      this._homeView = {
        latDeg: focus.latDeg,
        lngDeg: focus.lngDeg,
        distance: null,                       // 打开蓝图后按角半径现算，见 _applyHomeView 交给 rig 的 focusDeg
        elevationRad: HOME_ELEVATION_RAD,
        latRadiusDeg: focus.latRadiusDeg,
        lngRadiusDeg: focus.lngRadiusDeg,
      };
      if (resetView) this._applyHomeView();
    }
    this._applyLayers();                         // 已建好的层与开关对齐（图标是异步加载的，回来时再对一次）

    this._selectBuilding(null);                  // 每次重摆都没有选中（见方法注释，会通知回调）
    this._needsRender = true;
  }

  /**
   * 按落点把蓝图摆进场景: 建筑 / 传送带（含连接板条）/ 分拣器 / 图标四层，各一个 Group。
   *
   * @param {object} layout layoutBlueprint 的结果
   */
  _buildBlueprintObjects(layout) {
    if (!layout || !this._scene) return;

    /** 按显示层分好的三堆 */
    const split = { buildings: [], belts: [], inserters: [] };
    for (const building of layout.buildings) {
      if (!building) continue;                    // 占位空洞（序号对不上 / 落不了位，见 emitBuildings）
      // 带子 → 传送带层、分拣器 → 分拣器层、其余 → 建筑层
      const layer = isBelt(building.itemId) ? 'belts'
        : (isInserter(building.itemId) ? 'inserters' : 'buildings');
      split[layer].push(building);
    }
    this._allBuildings = layout.buildings;       // 下标 = 建筑序号：连线 / 分拣器 / 选中 / 高亮都取它（见 _addBeltLines 等）

    this._addBuildings(split.buildings);        // 建筑层: 碰撞箱长方体；认不出的画棋盘方块
    this._addBelts(split.belts);                // 带子本体（八棱柱），与连接板条同层
    this._addBeltLines(split.belts);            // 连接线
    this._addInserters(split.inserters);
    this._addIcons();                           // 图标层: 贴图是异步加载的，摆 sprite 之后就返回
  }

  /**
   * 一个碰撞箱在场景里的位姿（位置 + 朝向）: 箱体中心相对建筑原点的偏移跟着建筑朝向转，再贴到球面
   * （含离地高度）。建筑层的长方体与传送带的八棱柱都按它摆。
   *
   * 箱体中心 x 取负: 本预览的局部 +X 指向经度减小，游戏 LookRotation 的 +X 指向经度增大（叉乘手性不同），
   * 四元数表示不了反射，只能摆放时取负 —— 用「蓝图内建筑不重叠」约束实测过（取正会重叠、取负不会）。
   *
   * @param {object} building layoutBlueprint 出的建筑记录
   * @param {{center: number[], ext: number[]}} box 碰撞箱（游戏世界单位）
   * @param {{position: THREE.Vector3, quaternion: THREE.Quaternion}} out 复用的结果对象
   */
  _boxPose(building, box, out) {
    const quaternion = buildingOrientation(building);
    out.quaternion.copy(quaternion);
    out.position.copy(this._posOf(building)).add(
      new THREE.Vector3(-box.center[0], box.center[1], box.center[2])
        .multiplyScalar(GAME_UNIT_SCENE)
        .applyQuaternion(quaternion),
    );
    return out;
  }

  /**
   * 摆出**建筑层**的模型: 按真实尺寸和位置画碰撞箱长方体（数据见 buildingModels.js）
   *
   * @param {object[]} buildings 建筑层的建筑（已滤掉带子 / 分拣器）
   */
  _addBuildings(buildings) {
    if (!buildings.length) return;

    // 按「箱体形状 + 颜色」分组，同组合并成一个 InstancedMesh（同家族碰撞箱一样，靠颜色区分建筑）；
    const groups = new Map();
    const unknown = [];  // 未知模型
    for (const building of buildings) {
      const { color, colliders } = buildingModel(building.modelIndex);
      if (!colliders) {
        unknown.push(building);
        continue;
      }
      for (const box of colliders) {
        const key = `${color}|${box.center.join(',')}|${box.ext.join(',')}`;
        if (!groups.has(key)) groups.set(key, { box, color, items: [] });
        groups.get(key).items.push(building);
      }
    }

    if (!groups.size && !unknown.length) return;   // 这一堆里既没箱子也没认不出的: 什么都不建

    const materialOf = new Map();
    const group = this._layerGroup('buildings');

    const pose = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
    for (const { box, color, items } of groups.values()) {
      // 碰撞箱单位是游戏世界单位 → 场景单位
      const width = box.ext[0] * 2 * GAME_UNIT_SCENE;
      const height = box.ext[1] * 2 * GAME_UNIT_SCENE;
      const depth = box.ext[2] * 2 * GAME_UNIT_SCENE;

      // 同色共用一份材质，清理时按 Set 去重释放
      if (!materialOf.has(color)) {
        materialOf.set(color, new THREE.MeshStandardMaterial({
          color,
          roughness: 0.7,
          metalness: 0,
        }));
      }
      const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(width, height, depth), materialOf.get(color), items.length);
      mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      // 记下这组的信息（自检 / 调试用）
      mesh.userData.itemIds = [...new Set(items.map((b) => b.itemId))];
      mesh.userData.box = box;
      mesh.userData.color = color;
      /**
       * 拾取用: 每个实例对应哪栋建筑 —— 射线打中的 instanceId 就是这里的下标。
       * 一栋建筑可能出现在多个网格里（多块碰撞箱、按颜色分了组），所以每份网格各记一份。
       */
      mesh.userData.pickBuildings = items;
      const dummy = new THREE.Object3D();
      items.forEach((building, i) => {
        this._boxPose(building, box, pose);
        dummy.position.copy(pose.position);
        dummy.quaternion.copy(pose.quaternion);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      group.add(mesh);
    }

    if (!unknown.length) return;
    // 贴图与几何都共用模块级那份，所以网格自己 clone 一份（清理时按网格 dispose，见 _clearBuildings）
    const cube = new THREE.InstancedMesh(
      unknownCubeGeometry().clone(),
      new THREE.MeshStandardMaterial({ map: unknownCubeTexture().clone(), roughness: 0.7, metalness: 0 }),
      unknown.length,
    );
    cube.name = 'factory-unknown-buildings';
    cube.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    cube.userData.itemIds = [...new Set(unknown.map((b) => b.itemId))];
    cube.userData.modelIndexes = [...new Set(unknown.map((b) => b.modelIndex))];
    // 故意不设 cube.userData.pickBuildings: 未知建筑不计入拾取（见 _pickTargets / _pickBuilding）

    const dummy = new THREE.Object3D();
    unknown.forEach((building, i) => {
      // 立方体原点在中心，所以贴落点时抬半格（与碰撞箱中心的做法一致，见 _boxPose）
      dummy.position.copy(this._posOf(building))
        .addScaledVector(surfaceDirection(building.latDeg, building.lngDeg), CELL_SCENE * 0.5);
      dummy.quaternion.copy(buildingOrientation(building));
      dummy.updateMatrix();
      cube.setMatrixAt(i, dummy.matrix);
    });
    cube.instanceMatrix.needsUpdate = true;
    group.add(cube);
  }

  /**
   * 摆出带子本体: 一段一条正八棱柱（形状与尺寸见 buildingModels.js 的 BELT_OCTAGON_PRISM /
   * BELT_SIZE，都已烘在共用几何里，见 beltGeometry），这里只管摆位姿。连接板条与箭头见 _addBeltLines。
   *
   * @param {object[]} belts 传送带层的带子
   */
  _addBelts(belts) {
    if (!belts.length) return;

    const group = this._layerGroup('belts');       // 与连接板条 / 箭头同层，共用一个 Group
    group.name = 'factory-belts';

    /** 按颜色分组（三种带子三条网格，各一份材质与几何） */
    const perColor = new Map();
    for (const building of belts) {
      const { color } = buildingModel(building.modelIndex);
      if (!perColor.has(color)) perColor.set(color, []);
      perColor.get(color).push(building);
    }

    const dummy = new THREE.Object3D();
    for (const [color, list] of perColor) {
      const mesh = new THREE.InstancedMesh(
        beltGeometry().clone(),      // 每条网格各拿一份几何: 尺寸一样，清理时才敢按网格 dispose（共用那份不能动）
        new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0 }),
        list.length,
      );
      mesh.name = 'factory-belt-body';
      mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      // 记下这组的信息（自检 / 调试用）
      mesh.userData.itemIds = [...new Set(list.map((b) => b.itemId))];
      mesh.userData.color = color;
      // 拾取用: 每个实例对应哪条带子（instanceId 就是这里的下标，见 _buildingAt / _pickInstances）
      mesh.userData.pickBuildings = list;
      list.forEach((building, i) => {
        // 几何里已有尺寸与「底面贴地」的抬高，矩阵只放位置与朝向: 原点就是落点（本体从这儿往上长）
        dummy.position.copy(this._posOf(building));
        dummy.quaternion.copy(buildingOrientation(building));
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      group.add(mesh);
    }
  }

  /** 建筑在场景里的位置（含离地高度） */
  _posOf(b) {
    return surfaceDirection(b.latDeg, b.lngDeg)
      .multiplyScalar(PLANET_RADIUS + (b.altitudeSteps ?? 0) * ALTITUDE_STEP_SCENE);
  }

  /** 第二个端点的位置 —— 分拣器的爪臂末端，其余建筑与 _posOf 相同 */
  _endPosOf(b) {
    if (b.endLatDeg === undefined) return this._posOf(b);
    return surfaceDirection(b.endLatDeg, b.endLngDeg)
      .multiplyScalar(PLANET_RADIUS + (b.endAltitudeSteps ?? 0) * ALTITUDE_STEP_SCENE);
  }

  /**
   * 传送带之间的连接线（板条 + 箭头，与带子本体同层）
   *
   * @param {object[]} belts 传送带层的带子（已分好层，见 _buildBlueprintObjects）
   */
  _addBeltLines(belts) {
    const all = this._allBuildings;
    /** 连接的那一端: 序号就是下标 */
    const endAt = (index) => all[index];

    const links = [];
    const drawn = new Set();
    /** 建筑配色（自带或默认色，见 buildingModels.js 的 buildingModel） */
    const colorOf = (b) => buildingModel(b.modelIndex).color;
    /**
     * 每条连接只画一次（按两个建筑序号去重），a → b 就是物流方向。
     *
     * 颜色规则: 每端 = 带子时用自己带子的颜色、是建筑时用该条连接里带子的颜色；
     * 箭头单独取输出端 a（把东西送出去那一端）的颜色 —— 「黄带 → 蓝带」时箭头是黄带色。
     */
    const add = (a, b) => {
      if (!a || !b || a.index === b.index) return;
      const key = a.index < b.index ? `${a.index}|${b.index}` : `${b.index}|${a.index}`;
      if (drawn.has(key)) return;
      drawn.add(key);
      const beltA = isBelt(a.itemId);
      const beltB = isBelt(b.itemId);
      // 连接里那一端的带子（两端都是带子时各用各的）
      const beltColorAt = (self, selfIsBelt) => {
        if (selfIsBelt) return colorOf(self);
        const otherBelt = self === a ? (beltB ? b : null) : (beltA ? a : null);
        return otherBelt ? colorOf(otherBelt) : colorOf(self);
      };
      const aColor = beltColorAt(a, beltA);
      const bColor = beltColorAt(b, beltB);
      // 箭头 = 输出端 a 的颜色（输出端是建筑 → 带子色）
      const arrowColor = beltA ? colorOf(a) : (beltB ? colorOf(b) : colorOf(a));
      links.push({ a, b, colorA: aColor, colorB: bColor, arrowColor });
    };
    /** 不是带子也不是分拣器的，就是要连的建筑 */
    const isMachine = (b) => !!b && !isBelt(b.itemId) && !isInserter(b.itemId);

    for (const b of belts) {
      const src = endAt(b.conn?.in);
      const dst = endAt(b.conn?.out);
      // 入边: 上游 → 本带。上游是带子或建筑都画，箭头顺着物流方向
      if (src && (isBelt(src.itemId) || isMachine(src))) add(src, b);
      // 出边: 本带 → 下游。同理
      if (dst && (isBelt(dst.itemId) || isMachine(dst))) add(b, dst);
    }
    if (!links.length) return;
    this._addConnectors(links);
  }

  /**
   * 分拣器本体（独立一层）: 机身由 buildingModels.js 的 INSERTER_PARTS 组件表给出，这里只把两端摆到
   * 各自的落点与朝向上、连出爪臂、铺方向指示片。两端位姿全部来自蓝图自己的数据，不查接口表。
   *
   * @param {object[]} inserters 分拣器层的分拣器（已分好层，见 _buildBlueprintObjects）
   */
  _addInserters(inserters) {
    if (!inserters.length) return;

    const all = this._allBuildings;
    const colorOf = (b) => buildingModel(b.modelIndex).color;
    const isBuildingIdx = (idx) => {
      const t = all[idx];
      return !!t && !isBelt(t.itemId) && !isInserter(t.itemId);
    };

    /** 组件按角色分桶: frame = 立柱 / 爪臂（固定灰白），body = 横梁 / 长方体（用该分拣器自己的配色） */
    const frames = new Map();
    const bodies = new Map();
    const arrows = { matrices: [], owners: [] };

    const dummy = new THREE.Object3D();
    const basis = new THREE.Matrix4();
    /** 收一个实例: 当前 dummy 的矩阵进 buckets[color]，同时记下它属于哪台分拣器 */
    const collect = (buckets, color, building) => {
      let bucket = buckets.get(color);
      if (!bucket) {
        bucket = { matrices: [], owners: [] };
        buckets.set(color, bucket);
      }
      bucket.matrices.push(dummy.matrix.clone());
      bucket.owners.push(building);
    };
    /** 按组件表里的 role 挑桶与配色（见 buildingModels.js 的 INSERTER_PARTS） */
    const collectPart = (role, building) => {
      const frame = role === 'frame';
      collect(frame ? frames : bodies, frame ? INSERTER_MODEL.frameColor : colorOf(building), building);
    };
    /**
     * 照组件表摆一端的机身并返回爪臂挂点: 表里是本地坐标，这里乘上该端朝向 q。`inward` = 这一端朝爪臂的
     * 方向（两端对着摆），标了 inward 的端在本端 +Z 朝外时翻本地 Z（长方体对称，等价于转 180°）。
     */
    const placeEnd = (spec, pos, q, inward, building) => {
      const ax = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
      const ay = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
      const az = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
      const flip = spec.inward && az.dot(inward) < 0 ? -1 : 1;
      for (const part of spec.parts) {
        dummy.quaternion.copy(q);
        dummy.position.copy(pos)
          .addScaledVector(ax, part.position[0])
          .addScaledVector(ay, part.position[1])
          .addScaledVector(az, part.position[2] * flip);
        dummy.scale.set(part.size[0], part.size[1], part.size[2]);
        dummy.updateMatrix();
        collectPart(part.role, building);
      }
      // 爪臂挂点: 门架端 = 横梁中心，建筑端 = 长方体朝内面中心（跟着 flip 一起翻）
      return pos.clone()
        .addScaledVector(ax, spec.hinge[0])
        .addScaledVector(ay, spec.hinge[1])
        .addScaledVector(az, spec.hinge[2] * flip);
    };
    for (const b of inserters) {
      const baseIsBuilding = isBuildingIdx(b.conn?.in);
      const endIsBuilding = isBuildingIdx(b.conn?.out);
      const base = this._posOf(b);
      const end = this._endPosOf(b);

      // 门架沿爪臂方向各自向外挪一点，两个门架分居两端外侧，爪臂在中间连起来
      const axis = end.clone().sub(base);
      const axisLen = axis.length();
      const outward = axisLen > 1e-9 ? axis.divideScalar(axisLen) : new THREE.Vector3();

      /**
       * 竖直的爪子在爪臂轴上滚 180°（局部基底是镜像构造的，见 _boxPose 里 x 取负那段）。
       * 判据必须用世界竖直方向（该处球面法线），不能用模型局部的「上」: 竖直爪子（pitch=270°）的
       * 局部「上」已被转成水平，`outward · 局部上` ≈ 0，按那个判据永远不触发。
       */
      const worldUp = base.clone().normalize();
      const rollAboutArm = (q) => (Math.abs(outward.dot(worldUp)) > 0.9
        ? q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI))
        : q);
      /**
       * 两端朝向全部取自蓝图数据，蓝图给每台分拣器存了两套完整位姿:
       *   localOffset[0] + yaw[0] + tilt + pitch    = 抓取端（inputObjIdx 那一侧）
       *   localOffset[1] + yaw[1] + tilt2 + pitch2  = 放下端（outputObjIdx 那一侧）
       */
      const qBase = rollAboutArm(inserterEndQuaternion(b, false));
      const qEnd = rollAboutArm(inserterEndQuaternion(b, true));
      // 门架沿爪臂方向外移；长方体**不移动**，直接贴在端点上
      const gateOut = INSERTER_MODEL.gateOffset * GAME_UNIT_SCENE;
      const outBase = baseIsBuilding ? base.clone() : base.clone().addScaledVector(outward, -gateOut);
      const outEnd = endIsBuilding ? end.clone() : end.clone().addScaledVector(outward, gateOut);

      // 两端各自摆机身: 两端是对着摆的，所以「朝内」方向相反
      const armFrom = placeEnd(baseIsBuilding ? INSERTER_BLOCK : INSERTER_GATE, outBase, qBase, outward, b);
      const armTo = placeEnd(endIsBuilding ? INSERTER_BLOCK : INSERTER_GATE, outEnd, qEnd, outward.clone().negate(), b);
      /** 爪臂方向（= 箭头指向）= 抓取端 → 放下端（_posOf / _endPosOf 的顺序）; 别按「哪端是建筑」推，两端同类时会推反 */
      const armVec = armTo.clone().sub(armFrom);
      const armRealLen = armVec.length();
      if (armRealLen < 1e-9) continue;
      armVec.divideScalar(armRealLen);
      const armMid = armFrom.clone().add(armTo).multiplyScalar(0.5);
      const armNormal = armMid.clone().normalize();
      const armSide = new THREE.Vector3().crossVectors(armNormal, armVec);
      if (armSide.lengthSq() < 1e-10) {
        armSide.crossVectors(new THREE.Vector3(1, 0, 0), armVec);
        if (armSide.lengthSq() < 1e-10) armSide.crossVectors(new THREE.Vector3(0, 0, 1), armVec);
      }
      armSide.normalize();
      const armUp = new THREE.Vector3().crossVectors(armVec, armSide).normalize();
      dummy.quaternion.setFromRotationMatrix(basis.makeBasis(armSide, armUp, armVec));
      dummy.position.copy(armMid);
      dummy.scale.set(INSERTER_ARM_SECTION, INSERTER_ARM_SECTION, armRealLen);
      dummy.updateMatrix();
      collectPart(INSERTER_PARTS.arm.role, b);

      /**
       * 爪臂上的方向指示片: 沿手臂等距铺，尖端指向放手端（armVec 正方向），贴在 armUp 那面。
       * 两条容易踩的:
       *   1. PlaneGeometry(1,1) 的 +X = width、+Y = height（贴图 V 轴），所以长度要落在 +Y 上，
       *      缩放给 (宽, 长, 1) —— 基底 makeBasis(X=侧向, Y=沿臂, Z=朝上)。
       *   2. 侧向必须取 armVec × armUp（右手系）: 反过来是左手系，setFromRotationMatrix 会退化。
       */
      const spacing = INSERTER_ARROW.spacing * GAME_UNIT_SCENE;
      const arrowLen = INSERTER_ARROW.length * GAME_UNIT_SCENE;
      const arrowWid = INSERTER_ARROW.width * GAME_UNIT_SCENE;
      const arrowLift = INSERTER_ARM_SECTION * 0.5
        + (INSERTER_ARROW.gap + INSERTER_ARROW.thickness * 0.5) * GAME_UNIT_SCENE;
      const arrowSide = new THREE.Vector3().crossVectors(armVec, armUp).normalize();
      const count = Math.max(1, Math.floor(armRealLen / spacing));
      for (let k = 0; k < count; k += 1) {
        // 从抓取端往放手端等分排布
        const t = (k + 0.5) / count;
        dummy.position.copy(armFrom)
          .addScaledVector(armVec, t * armRealLen)
          .addScaledVector(armUp, arrowLift);
        dummy.quaternion.setFromRotationMatrix(basis.makeBasis(arrowSide, armVec, armUp));
        dummy.scale.set(arrowWid, arrowLen, 1);
        dummy.updateMatrix();
        // 箭头不分颜色（只有一片网格），直接进箭头那一桶
        arrows.matrices.push(dummy.matrix.clone());
        arrows.owners.push(b);
      }
    }

    const group = this._layerGroup('inserters');
    const pushMesh = (name, buckets) => {
      for (const [color, bucket] of buckets) {
        const mesh = new THREE.InstancedMesh(
          new THREE.BoxGeometry(1, 1, 1),
          new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0 }),
          bucket.matrices.length,
        );
        mesh.name = name;
        bucket.matrices.forEach((matrix, k) => mesh.setMatrixAt(k, matrix));
        mesh.instanceMatrix.needsUpdate = true;
        mesh.userData.pickBuildings = bucket.owners;    // 拾取: instanceId → 分拣器
        group.add(mesh);
      }
    };
    pushMesh('factory-inserter-frame', frames);
    pushMesh('factory-inserter-body', bodies);
    if (arrows.matrices.length) {
      const mesh = new THREE.InstancedMesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({
          map: getInserterArrowTexture(),
          transparent: true,
          opacity: INSERTER_ARROW.opacity,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
        arrows.matrices.length,
      );
      mesh.name = 'factory-inserter-arrows';
      arrows.matrices.forEach((matrix, k) => mesh.setMatrixAt(k, matrix));
      mesh.instanceMatrix.needsUpdate = true;
      // 指示片不进拾取表
      group.add(mesh);
    }
    group.userData.inserters = inserters.length;
    group.userData.inserterArrows = arrows.matrices.length;
  }

  /**
   * 建筑图标层（图标 id 空间见 markup/iconCatalog.ts，配方图标 id = 20000 + recipeId）:
   * 制造类 → 配方图标（id = 20000 + recipeId，自带 / 主产物图标见 markup/recipeIconProducts.ts）→ 504（无配方）；
   * 研究站 researchMode 2 → 704；传送带取 parameters.iconId；
   * 分拣器取 filterId；射线接收站按模式；物流配送器 / 四向分流器用本体图标 + filterId 角标；其余用自身 itemId。
   * 物流塔（见 stationPanelSlots）摆「塔内」卡片，替掉建筑自己的图标。
   *
   * 先一次遍历收集绘制清单（一栋一条，type 区分画法），再按画法 + 用到的图标分组异步合成贴图。
   */
  _addIcons() {
    const buildings = this._allBuildings;            // 下标 = 建筑序号
    const SIZE = CELL_SCENE;                         // 图标边长: 1 赤道格
    const LIFT_FLAT = 0.35 * CELL_SCENE;             // 分拣器: 抬 0.35 格
    const LIFT_FRACTION = 1 / 2;                     // 其他建筑: 抬到建筑高度的一半
    const TOP_GAP_CELLS = 3;                         // 但离顶部不超过 3 格（高建筑按这条往上贴）

    /** 传送带图标离地高度（世界单位） */
    const BELT_LIFT = 0.5;
    const BELT_LIFT_LINKED = 1.2;
    /** 要抬高的连接对象: 物流塔 / 大型采矿机、射线接收站、能量枢纽 */
    const BELT_LIFT_IDS = new Set([2103, 2104, 2316, 2208, 2209]);

    /** 传送带图标高度: 两端只要有一头连着上面那几种建筑就抬到 1.2，否则 0.5 */
    const beltLift = (b) => {
      const linked = [buildings[b.conn?.in], buildings[b.conn?.out]]
        .some((other) => !!other && BELT_LIFT_IDS.has(other.itemId));
      return (linked ? BELT_LIFT_LINKED : BELT_LIFT) * GAME_UNIT_SCENE;
    };

    /** 建筑顶部的高度（格）—— 用碰撞箱算（没有箱子的物品按 0 算） */
    const topCells = (b) => {
      let top = 0;
      for (const box of buildingModel(b.modelIndex).colliders ?? []) {
        top = Math.max(top, box.center[1] + box.ext[1]);
      }
      return (top * GAME_UNIT_SCENE) / CELL_SCENE;
    };

    /** 一般建筑头顶图标的高度（场景单位）: 取「一半高」与「离顶 3 格」里更高的那个 */
    const liftOf = (b) => {
      const top = topCells(b);
      return Math.max(top * LIFT_FRACTION, top - TOP_GAP_CELLS, 0) * CELL_SCENE;
    };

    /**
     * 绘制清单: 一栋一条 —— type 分四种（'card' 塔内卡片 / 'icon' / 'badgeIcon' / 'badgeCount'），
     * icons = [主图标 id, 角标]（icons[1] 是图标 id 还是数字由 type 定），另有 position / scale / slots / size。
     */
    const items = [];
    for (const b of buildings) {
      if (!b) continue;
      const lift = isBelt(b.itemId) ? beltLift(b) : (isInserter(b.itemId) ? LIFT_FLAT : liftOf(b));
      const position = this._posOf(b).addScaledVector(surfaceDirection(b.latDeg, b.lngDeg), lift);

      const slots = stationPanelSlots(b);
      if (slots) {
        items.push({ type: 'card', slots, position, name: 'factory-station-panel' });
        continue;
      }

      if (isBelt(b.itemId)) {
        // 图标标签槽 + 右下角数字（count = 0 只显示图标）
        const iconId = Number(b.parameters?.iconId ?? 0);
        const count = Number(b.parameters?.count ?? 0);
        if (!iconId) continue;
        items.push({
          type: count > 0 ? 'badgeCount' : 'icon',
          icons: count > 0 ? [iconId, count] : [iconId],
          position,
          scale: SIZE * 0.8,       // 传送带的图标比一格小一点
        });
      } else if (isInserter(b.itemId)) {
        // 分拣器的物品筛选；没筛选就没有图标
        const filterId = Number(b.filterId ?? 0);
        if (!filterId) continue;
        items.push({ type: 'icon', icons: [filterId], position, scale: SIZE * 0.5 });   // 分拣器的再小一档
      } else if (isAssembler(b.itemId) || isLab(b.itemId)) {
        const recipe = b.recipeId ?? 0;
        // 研究站额外看 researchMode 未选择 / 1 矩阵合成 / 2 科研模式
        const researchMode = b.parameters?.researchMode ?? 0;
        let id = recipe > 0 ? 20000 + recipe : 504;     // 配方图标 id（无配方 → 504）
        if (isLab(b.itemId) && researchMode === 2) id = 704;        // 科研模式
        else if (isLab(b.itemId) && researchMode === 0) id = 504;   // 未选择
        // 图标是配方 / 科研 / 无配方 —— 建筑本身得自己标出来
        items.push({ type: 'badgeIcon', icons: [id, b.itemId], position, scale: SIZE });
      } else if (b.itemId === 2208) {
        // 射线接收站: 右下角按模式压角标（发电 503 / 光子 1208）。productId: 0 直接发电、1208 光子生成
        items.push({
          type: 'badgeIcon',
          icons: [b.itemId, b.parameters?.productId === 1208 ? 1208 : 503],
          position,
          scale: SIZE,
        });
      } else if (b.itemId === 2107 || b.itemId === 2020) {
        // 物流配送器 / 四向分流器: 右下角压显示筛选的物品（filterId）
        items.push({ type: 'badgeIcon', icons: [b.itemId, b.filterId ?? 0], position, scale: SIZE });
      } else {
        items.push({ type: 'icon', icons: [b.itemId], position, scale: SIZE });
      }
    }
    if (!items.length) return;                     // 贴图都是异步来的，一个都没有就不建层

    const group = this._layerGroup('icons');       // 图标是独立一层（见 LAYERS）
    group.userData.buildings = items.length;
    this._icons = group;

    const nearPlane = this._camera.near * 1.05;
    const loader = new THREE.TextureLoader();
    /** 图标贴图: 主图标与角标同源（都是「图标 id → 图」，见 itemIconUrl），整份清单共用，同一个 id 只取一次 */
    const iconTextures = new Map();                // 图标 id → Promise<Texture|null>
    const iconTexture = (id) => {
      if (!iconTextures.has(id)) {
        const url = itemIconUrl(id);
        iconTextures.set(id, url ? loader.loadAsync(url).catch(() => null) : Promise.resolve(null));
      }
      return iconTextures.get(id);
    };

    /** 画法 + 图标 → 用它那些条目: 一张合成图只做一次、共用一个材质（type 分清 icons[1] 是图标还是数字） */
    const variants = new Map();
    /** 物流塔的「塔内」卡片: 顺手从同一份清单里挑出来 */
    const cards = [];
    for (const item of items) {
      if (item.type === 'card') {
        cards.push(item);
        continue;
      }
      const key = `${item.type}|${item.icons.join('|')}`;
      if (!variants.has(key)) variants.set(key, { type: item.type, icons: item.icons, list: [] });
      variants.get(key).list.push(item);
    }
    group.userData.iconCount = variants.size;

    for (const { type, icons, list } of variants.values()) {
      // 每个变体一个任务: 主图与角标图同时发请求（贴图是共享的，不在这里 dispose）
      (async () => {
        const [texture, badgeTexture] = await Promise.all([
          iconTexture(icons[0]),
          type === 'badgeIcon' ? iconTexture(icons[1]) : null,
        ]);
        if (!texture || this._icons !== group) return;   // 索引里没有这张图 / 期间换了蓝图
        // 图标是 UI 素材，必须声明成 sRGB: 渲染器输出是 sRGB（见 init），不声明就会被当成线性数据、
        // 输出时又转一次，颜色被整体抬高（发灰）。
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 4;

        // 角标合成到主图上；角标图没拿到就退回主图标材质
        let map = null;
        if (type === 'badgeCount') map = iconCountTexture(texture.image, icons[1]);
        else if (badgeTexture) map = iconBadgeTexture(texture.image, badgeTexture.image);
        const material = map ? iconSpriteMaterial(map, nearPlane) : iconSpriteMaterial(texture, nearPlane);
        for (const item of list) addIconSprite(group, item, material);

        this._applyLayers();           // 图标是异步来的: 加载期间若关了图标层，回来时要立刻藏好
        this._needsRender = true;
      })();
    }

    // 塔内卡片: 物品图标与上面的图标共用一份缓存
    for (const panel of cards) this._addStationPanel(group, panel, iconTexture, nearPlane);
  }

  /** 摆一张「塔内」卡片: 物品图标到齐后整张合成（见 stationPanelTexture），当一个 sprite 摆上去 */
  _addStationPanel(group, panel, iconTexture, nearPlane) {
    const ids = new Set();
    for (const slot of panel.slots) {
      if (slot.itemId > 0) ids.add(slot.itemId);
    }
    Promise.all([...ids].map(async (id) => [id, (await iconTexture(id))?.image ?? null]))
      .then((loaded) => {
        if (this._icons !== group) return;   // 期间换了蓝图 / 清了层
        const images = new Map(loaded.filter(([, image]) => !!image));
        const map = stationPanelTexture(panel.slots, images);
        // 尺寸按贴图现算: 一格 = 72 px（一行 96 px ≈ 1.33 格）
        const px = CELL_SCENE / 72;
        panel.size = [map.image.width * px, map.image.height * px];
        addIconSprite(group, panel, iconSpriteMaterial(map, nearPlane));

        this._applyLayers();         // 卡片是异步来的: 加载期间若关了图标层，回来时要立刻藏好
        this._needsRender = true;
      });
  }

  /** 清掉图标层 */
  _clearIcons() {
    const group = this._layerGroups.icons;
    if (!group) return;
    this._scene?.remove(group);
    group.children.forEach?.((child) => {
      // 不能 dispose geometry: three 的 Sprite 共用一份模块级几何（Sprite.js 的 _geometry），
      // 释放它会把全应用所有 Sprite（含球体预览的星空亮星）的几何一起标脏
      child.material?.map?.dispose();
      child.material?.dispose();
    });
    this._layerGroups.icons = null;
    this._icons = null;
    this._needsRender = true;
  }

  /**
   * 一条连接画出来的**三件套**（两半板条 + 箭头）的位姿与尺寸，场景单位: 局部 +X 宽、+Y 厚、+Z 长（沿流向）。
   * **画（_addConnectors）与高亮（_linkShells）共用这一处**，各写一份就会对不上；退化成零长度时返回 null。
   * @returns {Array<{kind: string, shape: string, position: THREE.Vector3, quaternion: THREE.Quaternion, size: THREE.Vector3}>|null}
   */
  _linkPieces(a, b) {
    const { from, to } = this._linkEndpoints(a, b);
    const dir = to.clone().sub(from);
    const length = dir.length();
    if (length < 1e-9) return null;
    dir.divideScalar(length);
    const mid = from.clone().add(to).multiplyScalar(0.5);
    const normal = mid.clone().normalize();                 // 该处的球面法线
    // 垂直连接时 dir 与法线几乎平行，normal × dir 退化成零向量（归一化出 NaN → 矩阵塌掉、画面闪烁）
    const side = new THREE.Vector3().crossVectors(normal, dir);
    if (side.lengthSq() < 1e-10) {
      side.crossVectors(new THREE.Vector3(1, 0, 0), dir);
      if (side.lengthSq() < 1e-10) side.crossVectors(new THREE.Vector3(0, 0, 1), dir);
    }
    side.normalize();
    const up = new THREE.Vector3().crossVectors(dir, side).normalize();
    const quaternion = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(side, up, dir),
    );

    // 三件套都立在地面上（底面贴地、往上长）: 位置落在两端连线上，各自沿路径的垂直方向（局部 +Y = up）
    // 抬「半个高」。注意别沿球面法线 normal 抬 —— 斜向连接时那样会偏出路径。
    const gauge = BELT_LINK.slabThickness * GAME_UNIT_SCENE;   // 板条立起来的高（箭头同厚）
    return [
      // 两半板条: 起端 → 中点、中点 → 末端，各占半根（盒子），抬半个厚 → 底面落在弦上
      {
        kind: 'slabA',
        shape: 'box',
        position: from.clone().lerp(mid, 0.5).addScaledVector(up, gauge * 0.5),
        quaternion,
        size: new THREE.Vector3(BELT_LINK.slabWidth * GAME_UNIT_SCENE, gauge, length * 0.5),
      },
      {
        kind: 'slabB',
        shape: 'box',
        position: mid.clone().lerp(to, 0.5).addScaledVector(up, gauge * 0.5),
        quaternion,
        size: new THREE.Vector3(BELT_LINK.slabWidth * GAME_UNIT_SCENE, gauge, length * 0.5),
      },
      // 箭头: 三棱柱（尖朝 +Z），中心抬到板条中高（再让开 arrowLift 那点缝隙防共面）→ 嵌在板条中间
      {
        kind: 'arrow',
        shape: 'prism',
        position: mid.clone().addScaledVector(up, gauge * (0.5 + BELT_LINK.arrowLift)),
        quaternion,
        size: new THREE.Vector3(
          BELT_LINK.arrowWidth * GAME_UNIT_SCENE,
          gauge,
          BELT_LINK.arrowLength * GAME_UNIT_SCENE,
        ),
      },
    ];
  }

  /**
   * 把一组连接画出来: 两半板条各用本端颜色，箭头用 arrowColor（输出端）。位姿尺寸都取自 _linkPieces。
   */
  _addConnectors(links) {
    /** 按颜色分组: 每种颜色一个 InstancedMesh */
    const perColor = new Map();
    const bucketOf = (color) => {
      if (!perColor.has(color)) perColor.set(color, { slabs: [], arrows: [] });
      return perColor.get(color);
    };

    const dummy = new THREE.Object3D();
    let n = 0;
    for (const { a, b, colorA, colorB, arrowColor } of links) {
      const pieces = this._linkPieces(a, b);
      if (!pieces) continue;
      for (const piece of pieces) {
        dummy.position.copy(piece.position);
        dummy.quaternion.copy(piece.quaternion);
        dummy.scale.copy(piece.size);
        dummy.updateMatrix();
        // 前两件是板条，第三件是箭头
        if (piece.kind === 'arrow') bucketOf(arrowColor).arrows.push(dummy.matrix.clone());
        else bucketOf(piece.kind === 'slabA' ? colorA : colorB).slabs.push(dummy.matrix.clone());
      }
      n += 1;
    }

    const group = this._layerGroup('belts');       // 连接线与带子本体同属传送带层，共用一个 Group
    group.name = 'factory-belts';

    for (const [color, bucket] of perColor) {
      if (bucket.slabs.length) {
        const mesh = new THREE.InstancedMesh(
          new THREE.BoxGeometry(1, 1, 1),
          new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0 }),
          bucket.slabs.length,
        );
        mesh.name = 'factory-connector-slabs';
        bucket.slabs.forEach((matrix, k) => mesh.setMatrixAt(k, matrix));
        mesh.instanceMatrix.needsUpdate = true;
        group.add(mesh);
      }
      if (bucket.arrows.length) {
        const mesh = new THREE.InstancedMesh(
          unitPrism().clone(),
          // 与建筑 / 板条同一种材质；flatShading 让每个三角面用面法线（否则顶点法线是各面平均的，
          // 三棱柱尖角处会发暗）
          new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0, flatShading: true }),
          bucket.arrows.length,
        );
        mesh.name = 'factory-connector-arrows';
        bucket.arrows.forEach((matrix, k) => mesh.setMatrixAt(k, matrix));
        mesh.instanceMatrix.needsUpdate = true;
        group.add(mesh);
      }
    }

    group.userData.links = n;
  }

  /**
   * 标出蓝图原点与各区域起点（都是一条从地表戳出来的细线）: 蓝图原点 = 主区域的锚点
   * （建筑偏移的参考点，旋转 180° 时是区域盒的另一端）；其余区域的锚点是红色短线。
   */
  _addMarkers(layout, primaryAreaIdx) {
    /** 各区域起点标记（红）与蓝图原点标记（橙） */
    const AREA_MARKER_COLOR = 0xff6b6b;
    const ORIGIN_MARKER_COLOR = 0xffb454;
    /** 标记线长度（场景单位；半径 1 的球面上一个赤道格 ≈ 0.00628） */
    const AREA_MARKER_LENGTH = 0.012;
    const ORIGIN_MARKER_LENGTH = 0.028;
    /** 起点离地表抬一点: 必须抬过网格线所在的半径，否则会被网格盖住半截 */
    const MARKER_BASE_LIFT = 0.0003;

    const group = new THREE.Group();
    group.name = 'factory-markers';

    const addLine = (latDeg, lngDeg, color, length) => {
      const dir = surfaceDirection(latDeg, lngDeg);
      const base = PLANET_RADIUS + MARKER_BASE_LIFT;
      const geometry = new THREE.BufferGeometry().setFromPoints([
        dir.clone().multiplyScalar(base),
        dir.clone().multiplyScalar(base + length),
      ]);
      group.add(new THREE.Line(geometry, new THREE.LineBasicMaterial({ color })));
    };

    /** 优先用锚点（建筑参考点），老数据没有就退回盒起点 */
    const anchorOf = (area) => ({
      latDeg: area.anchorLatDeg ?? area.startLatDeg,
      lngDeg: area.anchorLngDeg ?? area.startLngDeg,
    });

    layout.areas.forEach((area, i) => {
      if (i === primaryAreaIdx) return;
      const anchor = anchorOf(area);
      addLine(anchor.latDeg, anchor.lngDeg, AREA_MARKER_COLOR, AREA_MARKER_LENGTH);
    });
    const primary = layout.areas[primaryAreaIdx];
    if (primary) {
      const anchor = anchorOf(primary);
      addLine(anchor.latDeg, anchor.lngDeg, ORIGIN_MARKER_COLOR, ORIGIN_MARKER_LENGTH);
    }

    this._markers = group;
    this._scene.add(group);
  }

  /** 清掉上一份蓝图的各层、选中高亮与标记 */
  _clearBlueprintObjects() {
    this._clearBuildings();
    this._clearConnectors();
    this._clearInserters();
    this._clearIcons();
    this._clearMarkers();
    this._clearHighlight();
    // 各层都没了，建筑全表跟着作废（下一次 setBlueprint 重建）
    this._allBuildings = [];
  }

  /** 清掉分拣器本体（独立一层） */
  _clearInserters() {
    const group = this._layerGroups.inserters;
    if (!group) return;
    this._scene?.remove(group);
    group.children.forEach?.((child) => {
      child.geometry?.dispose();
      child.material?.dispose();
      child.dispose?.();              // InstancedMesh 自己的实例缓冲，漏了会一直占着显存
    });
    this._layerGroups.inserters = null;
    this._needsRender = true;
  }

  /** 清掉传送带层（带子本体与连接板条/箭头同属一个 Group，里面按颜色分了若干 InstancedMesh） */
  _clearConnectors() {
    const group = this._layerGroups.belts;
    if (!group) return;
    this._scene?.remove(group);
    group.children.forEach?.((child) => {
      child.geometry?.dispose();
      child.material?.dispose();
      child.dispose?.();              // InstancedMesh 自己的实例缓冲，漏了会一直占着显存
    });
    this._layerGroups.belts = null;
    this._needsRender = true;
  }

  /** 清掉建筑层（一个 Group，里面按碰撞箱形状分了几个 InstancedMesh，同色共享材质 */
  _clearBuildings() {
    const group = this._layerGroups.buildings;
    if (!group) return;
    this._scene?.remove(group);
    const materials = new Set();
    group.traverse((object) => {
      if (!object.geometry) return;
      object.geometry.dispose();
      if (object.material) materials.add(object.material);
      object.dispose?.();               // InstancedMesh 自己的实例缓冲
    });
    for (const material of materials) {
      material.map?.dispose();          // 建筑层的方块没有贴图，只有未知建筑那份有
      material.dispose();
    }
    this._layerGroups.buildings = null;
    this._needsRender = true;
  }

  /** 清掉原点 / 区域起点标记（每个标记各有一份 geometry 与 material） */
  _clearMarkers() {
    if (!this._markers) return;
    this._scene?.remove(this._markers);
    this._markers.traverse((object) => {
      if (!object.geometry) return;
      object.geometry.dispose();
      object.material?.dispose();
    });
    this._markers = null;
    this._needsRender = true;
  }

  // ─── 显示层开关 ─────────────────────────────────────────────
  /** 该层是否显示（未知层名按显示处理） */
  _layerVisible(name) {
    return this._layers[name] !== false;
  }

  /**
   * 取某一层的 Group，没有就建一个挂进场景
   * @param {'buildings'|'belts'|'inserters'|'icons'} name
   */
  _layerGroup(name) {
    let group = this._layerGroups[name];
    if (!group) {
      group = new THREE.Group();
      group.name = `factory-${name}`;
      this._layerGroups[name] = group;
      this._scene.add(group);
    }
    return group;
  }

  /** 开关一个显示层（层名见 LAYERS）: 只记开关并同步 Group.visible */
  setLayerVisible(name, visible = true) {
    if (!LAYERS.includes(name)) return;
    this._layers[name] = !!visible;
    this._applyLayers();
    this._needsRender = true;
  }

  /** 把各层开关同步到已建好的场景对象上（一层一个 Group，互不影响）；高亮不跟着层藏 */
  _applyLayers() {
    for (const name of LAYERS) {
      const group = this._layerGroups[name];
      if (group) group.visible = this._layerVisible(name);
    }
  }

  /** 显示 / 隐藏网格线 */
  setGridVisible(visible = true) {
    this._gridVisible = !!visible;
    this._updateGridVisibility();
    this._needsRender = true;
  }

  /**
   * 目标纬度: 吸附到离它最近的位置（单区域则把区域中心摆到这条纬线上）；改了要重摆一遍。
   * @param {number|null} latDeg 目标纬度（度）；null = 自动
   * @param {boolean} [north] 目标半球（true 北 / false 南），默认按 latDeg 正负 —— 纬度 0 时
   *   正负号表达不了半球，所以要能单独给。
   */
  setTargetLatitude(latDeg, north = undefined) {
    const value = Number.isFinite(latDeg) ? Math.min(90, Math.max(-90, Number(latDeg))) : null;
    const half = typeof north === 'boolean' ? north : (value === null ? null : value >= 0);
    if (value === this._targetLatDeg && half === this._targetNorth) return;
    this._targetLatDeg = value;
    this._targetNorth = half;
    if (this._blueprint) this.setBlueprint(this._blueprint);
  }

  /** 细网格跟着相机距离显示 */
  _updateGridVisibility() {
    if (!this._gridLines) return;
    const close = this._camera.position.length() <= PLANET_FINE_GRID_MAX_DISTANCE;
    this._gridLines.visible = this._gridVisible && close;
    this._gridLinesMajor.visible = this._gridVisible;
    this._gridLinesEquator.visible = this._gridVisible;
  }

  // ─── 选中与拾取（点击建筑） ───────────────────────────────────
  /**
   * 挂「选中变化」的回调: listener(index)，取消选中时是 null。传 null 摘掉。
   * index = 蓝图里记的建筑序号（与 conn 同一套）；只在选中真的变了时调一次。
   */
  setSelectionListener(listener) {
    this._selectionListener = typeof listener === 'function' ? listener : null;
  }

  /**
   * 程序化选中一栋建筑
   * @param {number|null} index 建筑序号（蓝图里记的 building.index）；null = 取消选中
   * @returns {boolean} 编号真的变了没有（没变就什么都不做，高亮也不重画）
   */
  selectBuilding(index) {
    const next = Number.isInteger(index) ? Number(index) : null;
    if (next === this._selectedIndex) return false;
    // 序号就是下标: 取不到（-1 / 越界 / 空位）当作没这栋
    this._selectBuilding(next === null ? null : (this._allBuildings[next] ?? null));
    return true;
  }

  /**
   * 落地一次选中: 只记编号 + 重画高亮，编号变了才通知回调。
   * @param {object|null} building 选中的建筑记录（只为取编号与画壳临时用一下）
   */
  _selectBuilding(building) {
    const next = building ?? null;
    const index = next?.index ?? null;
    const changed = index !== this._selectedIndex;
    this._selectedIndex = index;
    this._showHighlight(next);
    if (changed) this._selectionListener?.(index);
  }

  /**
   * 点击拾取: 点到建筑就选中它，再点同一栋 / 点空处则取消（单选，没有多选）。位置用画布坐标。
   */
  _clickSelect(clientX, clientY) {
    const building = this._pickBuilding(clientX, clientY);
    const index = building?.index ?? null;
    if (index === null || index === this._selectedIndex) {
      this._selectBuilding(null);                 // 空处 / 已选中的那一栋 → 取消
      return;
    }
    this._selectBuilding(building);
  }

  /** 光标下的建筑: 往可拾取对象打一条射线取最近交点；被行星球挡住的（地平线背面）不算 */
  _pickBuilding(clientX, clientY) {
    const canvas = this._canvas;
    if (!canvas || !this._camera) return null;
    const targets = this._pickTargets();
    if (!targets.length) return null;

    const rect = canvas.getBoundingClientRect?.();
    const width = rect?.width || canvas.clientWidth || 1;
    const height = rect?.height || canvas.clientHeight || 1;
    if (!this._pickRay) this._pickRay = new THREE.Raycaster();
    this._pickRay.setFromCamera(new THREE.Vector2(
      ((clientX - (rect?.left ?? 0)) / width) * 2 - 1,
      1 - ((clientY - (rect?.top ?? 0)) / height) * 2,
    ), this._camera);

    const hit = this._pickRay.intersectObjects(targets, false)[0];
    if (!hit) return null;
    if (!this._probeSphere) this._probeSphere = new THREE.Sphere(new THREE.Vector3(), PLANET_RADIUS);
    const surface = this._pickRay.ray.intersectSphere(this._probeSphere, new THREE.Vector3());
    if (surface && surface.distanceTo(this._pickRay.ray.origin) < hit.distance) return null;

    return hit.object?.userData?.pickBuildings?.[hit.instanceId] ?? null;
  }

  /**
   * 能拾取的对象: 各显示层里带 pickBuildings 的网格；关掉的层不参与（看不见的不该被点到）。
   */
  _pickTargets() {
    const targets = [];
    for (const name of LAYERS) {
      const group = this._layerGroups[name];
      if (!group || group.visible === false) continue;
      for (const child of group.children) {
        if (child.visible !== false && child.userData?.pickBuildings) targets.push(child);
      }
    }
    return targets;
  }

  /**
   * 画出选中的高亮: 普通建筑 = 每个碰撞箱一个壳、分拣器 = 沿爪臂的一个盒子（外扩见 HIGHLIGHT.grow）；
   * 传送带 = 选中那一格用普通高亮，整条相连的线更淡更灰、只外扩一点点（见 HIGHLIGHT.belt.grow）。
   * 「并入」只在**线上这一格并入别人**时画那一段，别人并进线上这格的不画；没有建模数据的不画壳。
   */
  _showHighlight(building) {
    this._clearHighlight();
    if (!building || !this._scene) return;

    const group = new THREE.Group();
    group.name = 'factory-highlight';
    if (isBelt(building.itemId)) {
      const all = this._allBuildings;
      const { belts, links } = this._beltNetwork(building, all);
      const network = [];
      const beltGrow = HIGHLIGHT.belt.grow;      // 整条线的壳只往外长一点点（选中那一格用普通外扩）
      for (const index of belts) {
        if (index === building.index) continue;
        const other = all[index];
        if (other) network.push(...this._highlightShells(other, beltGrow));
      }
      for (const link of links) {
        // 并入那一段: 只有「线上这一格（link.a）并入别人」才画；别人并入线上这一格的（link.a 在线外）不画
        if (link.merge && !belts.has(link.a.index)) continue;
        // 一条连接 = 两半板条 + 箭头，三个壳各算各的（不并成一根长条）
        for (const shell of this._linkShells(link.a, link.b, beltGrow)) network.push(shell);
      }
      this._addShells(group, this._highlightShells(building, HIGHLIGHT.grow), false);
      this._addShells(group, network, true);
    } else {
      this._addShells(group, this._highlightShells(building, HIGHLIGHT.grow), false);
    }
    if (!group.children.length) return;

    this._highlight = group;
    this._scene.add(group);
    this._needsRender = true;
  }

  /**
   * 把一组壳按样式挂进高亮组（参数见 HIGHLIGHT）
   * @param {boolean} dim 更小更淡的那一套（传送带整条线）还是普通那一套
   */
  _addShells(group, shells, dim) {
    const geometry = this._highlightGeometry(shells);
    if (!geometry) return;
    // 两种壳都关掉深度测试: 被建筑 / 地形挡住也看得见（depthWrite 也关着，不影响别的透明物）
    const fill = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
      color: dim ? HIGHLIGHT.belt.color : HIGHLIGHT.color,
      transparent: true,
      opacity: dim ? HIGHLIGHT.belt.fillOpacity : HIGHLIGHT.fillOpacity,
      depthTest: false,
      depthWrite: false,
      ...HIGHLIGHT.fillBlend,           // 重叠处取较亮的一方（见 HIGHLIGHT.fillBlend）
    }));
    fill.renderOrder = HIGHLIGHT.renderOrder;
    group.add(fill);
  }

  /**
   * 把一串壳合成一份填充几何: 一条传送带网络几百格，逐格建对象会变成上千次绘制，所以在这里一次摊平。
   * 每个壳按 `shape` 取单位拓扑（box / prism / octagon，箭头是三棱柱、带子格是八棱柱）再摆过去。
   * @param {Array<object>} shells 壳（见 _highlightShells / _linkShells）
   * @returns {THREE.BufferGeometry|null}
   */
  _highlightGeometry(shells) {
    if (!shells.length) return null;

    /** 单位拓扑: box（建筑 / 板条）、prism（箭头）、octagon（传送带格，两轴是对边距）；都是只读数据 */
    const box = new THREE.BoxGeometry(1, 1, 1);
    const units = {
      box: {
        position: box.attributes.position.array,
        index: box.index.array,
      },
      prism: {
        position: unitPrism().attributes.position.array,
        index: unitPrism().index.array,
      },
      octagon: {
        position: BELT_OCTAGON_PRISM.positions,
        index: BELT_OCTAGON_PRISM.index,
      },
    };

    const fillPosition = [];
    const fillIndex = [];
    const matrix = new THREE.Matrix4();
    const point = new THREE.Vector3();
    for (const shell of shells) {
      const unit = units[shell.shape] ?? units.box;
      matrix.compose(shell.position, shell.quaternion, shell.size);
      const base = fillPosition.length / 3;
      for (let i = 0; i < unit.position.length; i += 3) {
        point.set(unit.position[i], unit.position[i + 1], unit.position[i + 2]).applyMatrix4(matrix);
        fillPosition.push(point.x, point.y, point.z);
      }
      for (let i = 0; i < unit.index.length; i += 1) fillIndex.push(unit.index[i] + base);
    }
    box.dispose();

    const fill = new THREE.BufferGeometry();
    fill.setAttribute('position', new THREE.Float32BufferAttribute(fillPosition, 3));
    // 顶点数超过 65535 就得用 32 位索引（几千格的带子网络会撞上）
    fill.setIndex(new THREE.BufferAttribute(
      fillPosition.length / 3 > 65535 ? new Uint32Array(fillIndex) : new Uint16Array(fillIndex), 1));
    return fill;
  }

  /**
   * 一条传送带的**线**: 从点中的带子出发沿连接关系**前后都走**（蓝图只写输出端，反向索引见 _beltLinks），
   * 收集整条线的带子与它们画出来的连接；「并入」的支线只画不跟（那是另一条线汇进来）。
   * @param {Array<object|null>} all 建筑全表（下标 = 建筑序号）
   * @returns {{belts: Set<number>, links: Array<{a: object, b: object, merge: boolean}>}}
   */
  _beltNetwork(building, all) {
    const { outgoing, incoming } = this._beltLinks(all);
    const belts = new Set([building.index]);
    const links = [];
    const drawn = new Set();
    const queue = [building];
    // 同一条连接可能从两头各看到一次，按序号去重；merge 原样带上（a = 输出端，_showHighlight 要用）
    const addLink = (a, b, merge) => {
      if (a.index === b.index) return;
      const key = a.index < b.index ? `${a.index}|${b.index}` : `${b.index}|${a.index}`;
      if (drawn.has(key)) return;
      drawn.add(key);
      links.push({ a, b, merge });
    };
    /** 顺着这条边继续走: 并入的边只画不跟 */
    const walk = (belt, merge) => {
      if (merge || belts.has(belt.index)) return;
      belts.add(belt.index);
      queue.push(belt);
    };

    while (queue.length) {
      const current = queue.pop();
      for (const { target, merge } of outgoing.get(current.index) ?? []) {
        addLink(current, target, merge);
        if (isBelt(target.itemId)) walk(target, merge);
      }
      for (const { source, merge } of incoming.get(current.index) ?? []) {
        addLink(source, current, merge);
        if (isBelt(source.itemId)) walk(source, merge);
      }
    }
    return { belts, links };
  }

  /**
   * 传送带连接表: 每条边带 `merge` 标记 —— true 的只用来画，不顺着往前串（见 _beltNetwork）。
   *
   * 蓝图只写输出端（A.outputObjIdx = B，B 的 inputObjIdx 为空），带子间的上游关系靠自建反向索引 incoming。
   * 带子之间**不看蓝图的 outputToSlot**（那只是存档那一刻的连接，游戏粘贴时按几何重算），主输入也按几何算:
   * 只有一条喂它 → 就是它；多条 → 取与「前方」夹角最大且 ≥ BELT_MAIN_INPUT_MIN_ANGLE 的那条（正后方 180°）；
   * 都在侧面 / 前面，或两条都在后方且互相夹角也 ≥ 门槛 → 没有主输入。
   * **merge = 该边不是目标的主输入**；目标是机器时照收（产线末端插进机器的接口），分拣器不连线。
   *
   * @param {Array<object|null>} all 建筑全表（下标 = 建筑序号）
   * @returns {{outgoing: Map, incoming: Map}} 值形如 `{target|source, merge}`
   */
  _beltLinks(all) {
    const outgoing = new Map();
    const incoming = new Map();
    const isMachine = (b) => !isBelt(b.itemId) && !isInserter(b.itemId);
    const add = (source, target, merge) => {
      if (!outgoing.has(source.index)) outgoing.set(source.index, []);
      outgoing.get(source.index).push({ target, merge });
      if (!incoming.has(target.index)) incoming.set(target.index, []);
      incoming.get(target.index).push({ source, merge });
    };

    // 把所有出边按目标收集一遍 = 可能喂它的带子（只走带子: 别的建筑在这张表里没用）
    const sourcesOf = new Map();
    for (const belt of all) {
      if (!belt || !isBelt(belt.itemId)) continue;
      const target = all[belt.conn?.out];
      if (!target || !isBelt(target.itemId) || target.index === belt.index) continue;
      if (!sourcesOf.has(target.index)) sourcesOf.set(target.index, []);
      sourcesOf.get(target.index).push(belt);
    }

    /** 目标序号 → 主输入那一格的序号（不在表里 = 没有主输入，喂它的都算并入） */
    const mainInput = new Map();
    for (const [index, sources] of sourcesOf) {
      if (sources.length === 1) {
        mainInput.set(index, sources[0].index);
        continue;
      }
      const belt = all[index];
      const forward = BELT_FORWARD.clone().applyQuaternion(buildingOrientation(belt));
      const scored = sources.map((source) => {
        const direction = this._posOf(source).clone().sub(this._posOf(belt)).normalize();
        return { source, direction, angle: direction.angleTo(forward) / DEG };      // 180° = 正后方
      }).sort((a, b) => b.angle - a.angle);
      const behind = scored.filter((item) => item.angle >= BELT_MAIN_INPUT_MIN_ANGLE);
      if (!behind.length) continue;
      // 两条都在后方且互相夹角也 ≥ 门槛 → 没有主输入
      const spread = behind.length > 1 ? behind[0].direction.angleTo(behind[1].direction) / DEG : 0;
      if (spread >= BELT_MAIN_INPUT_MIN_ANGLE) continue;
      mainInput.set(index, behind[0].source.index);
    }

    for (const belt of all) {
      if (!belt || !isBelt(belt.itemId)) continue;
      const target = all[belt.conn?.out];
      if (target && target.index !== belt.index) {
        if (isBelt(target.itemId)) add(belt, target, mainInput.get(target.index) !== belt.index);
        else if (isMachine(target)) add(belt, target, false);
      }
      const source = all[belt.conn?.in];
      if (source && source.index !== belt.index && isMachine(source)) add(source, belt, false);
    }
    return { outgoing, incoming };
  }

  /**
   * 一栋建筑在场景里的实例（网格 + 实例下标）: 现扫各层的拾取表。
   * 不看层的显示开关（与拾取 _pickTargets 不同）: 壳按画出来的几何算，跟层此刻可不可见无关。
   * @returns {Array<{mesh: object, instanceId: number}>}
   */
  _pickInstances(index) {
    const instances = [];
    for (const name of LAYERS) {
      const group = this._layerGroups[name];
      if (!group) continue;
      for (const child of group.children) {
        const owners = child.userData?.pickBuildings;
        if (!owners) continue;
        owners.forEach((owner, instanceId) => {
          if (owner.index === index) instances.push({ mesh: child, instanceId });
        });
      }
    }
    return instances;
  }

  /**
   * 一条连接的两个端点（场景坐标）: 起点分拣器用爪臂末端、其余用建筑原点，终点一律建筑原点。
   * **画（_addConnectors）与高亮（_linkShells）共用这一处**，各写一份高亮的壳就会跟画出来的对不上。
   */
  _linkEndpoints(a, b) {
    let from = isInserter(a.itemId) ? this._endPosOf(a) : this._posOf(a);
    const to = this._posOf(b);
    // 分拣器的臂端常正好落在目标格上（重合），这时连接退化成零长度 —— 退回基座画一段有长度的
    if (from.distanceTo(to) < 1e-6) from = this._posOf(a);
    return { from, to };
  }

  /**
   * 一段传送带连接的高亮壳: **三件套各来一个**（两半板条是盒子 + 中间箭头是三棱柱），
   * 逐件取自 _linkPieces（`shape` 带过去，见 _highlightGeometry）。
   * @param {number} [growWorld] 每个面往外长多少（游戏世界单位）；不给就是不外扩
   * @returns {Array<{shape: string, position: THREE.Vector3, quaternion: THREE.Quaternion, size: THREE.Vector3}>}
   */
  _linkShells(a, b, growWorld = 0) {
    const pieces = this._linkPieces(a, b);
    if (!pieces) return [];
    const grow = growWorld * GAME_UNIT_SCENE * 2;      // 每个面往外长 → 边长加两倍
    return pieces.map((piece) => ({
      shape: piece.shape,
      position: piece.position,
      quaternion: piece.quaternion,
      size: piece.size.clone().addScalar(grow),
    }));
  }

  /**
   * 高亮壳（场景单位）: 普通建筑 = **每个碰撞箱一个壳**（长方体），位姿与尺寸跟画出来的箱子（见 _boxPose）逐一对齐；
   * 传送带 = 一个**八棱柱**壳（跟画出来的带子同形同尺寸，见 _addBelts / BELT_SIZE）；
   * 分拣器取沿爪臂的一个包围盒（见 _highlightQuaternion）。
   * @param {number} [growWorld] 每个面往外长多少（游戏世界单位）；不给就是**不外扩**
   * @returns {Array<{shape: string, position: THREE.Vector3, quaternion: THREE.Quaternion, size: THREE.Vector3}>}
   */
  _highlightShells(building, growWorld = 0) {
    const grow = growWorld * GAME_UNIT_SCENE * 2;      // 每个面往外长 → 边长加两倍
    if (isBelt(building.itemId)) {
      // 带子本体立在落点上（底面贴地，见 beltGeometry），所以壳的位姿也要抬同样的高度才对得上；
      // 尺寸与画出来的带子同源（BELT_SIZE），不查碰撞箱。
      // 壳不外扩时也一样走 size（两轴 = 对边距、竖轴 = 高），所以壳就是放大一圈的同形八棱柱
      return [{
        shape: 'octagon',
        position: this._posOf(building)
          .addScaledVector(surfaceDirection(building.latDeg, building.lngDeg), BELT_BASE_LIFT),
        quaternion: buildingOrientation(building),
        size: new THREE.Vector3(
          BELT_SIZE.width * GAME_UNIT_SCENE + grow,
          BELT_SIZE.height * GAME_UNIT_SCENE + grow,
          BELT_SIZE.depth * GAME_UNIT_SCENE + grow,
        ),
      }];
    }
    if (!isInserter(building.itemId)) {
      const pose = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
      return (buildingModel(building.modelIndex).colliders ?? []).map((box) => {
        this._boxPose(building, box, pose);
        return {
          shape: 'box',
          position: pose.position.clone(),
          quaternion: pose.quaternion.clone(),
          size: new THREE.Vector3(
            box.ext[0] * 2 * GAME_UNIT_SCENE + grow,
            box.ext[1] * 2 * GAME_UNIT_SCENE + grow,
            box.ext[2] * 2 * GAME_UNIT_SCENE + grow,
          ),
        };
      });
    }

    // 分拣器: 把画出来的全部几何的角点摊到世界坐标，在沿爪臂的基里取一个包围盒
    const refs = this._pickInstances(building.index);
    if (!refs.length) return [];
    const corners = [];
    const matrix = new THREE.Matrix4();
    const corner = new THREE.Vector3();
    for (const { mesh, instanceId } of refs) {
      const geometry = mesh.geometry;
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      const box = geometry.boundingBox;
      mesh.getMatrixAt(instanceId, matrix);
      matrix.premultiply(mesh.matrixWorld);
      for (let i = 0; i < 8; i += 1) {
        corner.set(
          (i & 1) ? box.max.x : box.min.x,
          (i & 2) ? box.max.y : box.min.y,
          (i & 4) ? box.max.z : box.min.z,
        ).applyMatrix4(matrix);
        corners.push(corner.clone());
      }
    }
    if (!corners.length) return [];

    const quaternion = this._highlightQuaternion(building);
    const toLocal = quaternion.clone().invert();
    const min = new THREE.Vector3(Infinity, Infinity, Infinity);
    const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    for (const point of corners) {
      const local = point.clone().applyQuaternion(toLocal);
      min.min(local);
      max.max(local);
    }

    return [{
      shape: 'box',
      // 基只有旋转（球心在原点），所以「局部中点转回来」就是世界坐标
      position: min.clone().add(max).multiplyScalar(0.5).applyQuaternion(quaternion),
      quaternion,
      size: max.clone().sub(min).addScalar(grow),
    }];
  }

  /**
   * 分拣器高亮盒的朝向: 沿**爪臂**建基（两端朝向不同、爪臂还可能竖直支起来，
   * 只有顺着爪臂取包围盒才既包得住整台又不虚胖）；爪臂退化成一个点时退回建筑自身朝向。
   */
  _highlightQuaternion(building) {
    const base = this._posOf(building);
    const end = this._endPosOf(building);
    const along = end.clone().sub(base);
    if (along.lengthSq() < 1e-18) return buildingOrientation(building);
    along.normalize();
    const up = base.clone().add(end).normalize();          // 爪臂中点的球面法线
    const side = new THREE.Vector3().crossVectors(up, along);
    if (side.lengthSq() < 1e-12) side.crossVectors(new THREE.Vector3(1, 0, 0), along);
    side.normalize();
    const armUp = new THREE.Vector3().crossVectors(along, side).normalize();
    return new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(side, armUp, along),
    );
  }

  /** 清掉高亮壳（取消选中、换蓝图、销毁都走这里） */
  _clearHighlight() {
    if (!this._highlight) return;
    this._scene?.remove(this._highlight);
    this._highlight.traverse((object) => {
      object.geometry?.dispose();
      object.material?.dispose();     // 同组内共享，重复 dispose 无害
    });
    this._highlight = null;
    this._needsRender = true;
  }

  // ─── 视角与操作（机位数学在 cameraRig；这里只剩归位目标与「抬起后拾取」） ──
  /** 复位视角: 回到当前「归位」目标（打开蓝图后是蓝图中心，否则是赤道 0° 经线，见 DEFAULT_HOME_VIEW） */
  resetView() {
    this._rig?.reset();
    this._needsRender = true;
  }

  /** 把「归位」目标交给 rig: 蓝图中心（按角半径现算取景距离）或默认机位（见 DEFAULT_HOME_VIEW） */
  _applyHomeView() {
    const { latDeg, lngDeg, distance, elevationRad } = this._homeView;
    // latRadiusDeg / lngRadiusDeg 是蓝图给的角半径: 交给 rig 按当前宽高比现算取景距离（画布变了会重框一次）
    const focusDeg = this._homeView.latRadiusDeg === undefined
      ? null
      : { latRadiusDeg: this._homeView.latRadiusDeg, lngRadiusDeg: this._homeView.lngRadiusDeg };
    this._rig?.setHome(latDeg, lngDeg, distance, elevationRad, focusDeg);
    this._rig?.reset();
    this._needsRender = true;
  }

  /** 抬起: rig 收尾后取「这一次算不算点了一下」的结论 —— 算就拾取（rig 只给结论，谁消费是这边的事） */
  _onPointerUp(event) {
    this._rig?.endPointer(event);
    if (this._rig?.consumeClick()) this._clickSelect(event.clientX, event.clientY);
  }

  /** 按下 W/A/S/D: 只记键位（键位表与走动都在 rig 里） */
  _onKeyDown(event) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (!this._rig?.isMoveKey(event.code)) return;
    if (isTypingTarget(event.target)) return;
    this._moveKeys.add(event.code);
  }

  /** 抬起: 松开那个方向 */
  _onKeyUp(event) {
    this._moveKeys.delete(event.code);
  }

  /** 主光跟着相机走（头灯）: 转到哪一面都看得清 */
  _updateKeyLight() {
    this._keyLight.position
      .copy(this._lightOffset)
      .applyQuaternion(this._camera.quaternion)
      .add(this._camera.position);
  }

  // ─── 渲染循环 ───────────────────────────────────────────────
  resize() {
    const canvas = this._canvas;
    if (!canvas || !this._renderer) return;
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    this._renderer.setSize(w, h, false);
    this._rig?.setAspect(w / h);            // 相机的 aspect 与投影矩阵一起动（rig 持有相机）
    this._needsRender = true;
  }

  _startLoop() {
    const tick = () => {
      this._frameId = requestAnimationFrame(tick);
      // 按键挪观察点要按帧长算步长（首帧没有上一帧时间戳，跳过）
      const now = performance.now();
      const dt = this._lastTickTime ? Math.min(0.1, (now - this._lastTickTime) / 1000) : 0;
      this._lastTickTime = now;
      // W/A/S/D、阻尼与仰角限位都在这一步推进；返回 false = 这一帧视角没动，可以跳过绘制
      const viewMoved = !!this._rig?.tick(dt);
      if (!viewMoved && !this._needsRender) return;
      this._needsRender = false;
      // 缩放会改变相机距离，细网格的显示要跟着算
      this._updateGridVisibility();
      this._updateKeyLight();
      this._renderer.render(this._scene, this._camera);
    };
    tick();
  }

  dispose() {
    if (this._frameId != null) cancelAnimationFrame(this._frameId);
    this._frameId = null;
    this._resizeObserver?.disconnect();
    this._resizeObserver = null;
    if (this._keyHandlers) {
      if (typeof window !== 'undefined') {
        window.removeEventListener('keydown', this._keyHandlers.down);
        window.removeEventListener('keyup', this._keyHandlers.up);
        window.removeEventListener('blur', this._keyHandlers.blur);
      }
      this._keyHandlers = null;
    }
    this._moveKeys.clear();
    this._lastTickTime = 0;
    this._rig?.dispose();
    this._rig = null;
    for (const lineSegments of [this._gridLines, this._gridLinesMajor, this._gridLinesEquator]) {
      lineSegments?.geometry.dispose();
      lineSegments?.material.dispose();
    }
    this._gridLines = null;
    this._gridLinesMajor = null;
    this._gridLinesEquator = null;
    this._clearBlueprintObjects();
    this._planet?.geometry.dispose();
    this._planet?.material.dispose();
    this._planet = null;
    if (this._starfield) {
      this._scene?.remove(this._starfield);
      disposeStarfield(this._starfield);
      this._starfield = null;
    }
    this._keyLight = null;
    // 主动丢上下文: 组件是 v-if 反复挂载（切工具就销毁重建），只 dispose() 要等 GC 才释放，
    // 而浏览器同时存活的 WebGL 上下文有上限（常见 16 个），切来切去可能把新上下文挤掉
    if (this._renderer) {
      this._renderer.dispose();
      this._renderer.forceContextLoss?.();
    }
    this._renderer = null;
    if (this._pointerHandlers) {
      this._canvas?.removeEventListener('pointerdown', this._pointerHandlers.down);
      if (typeof window !== 'undefined') {
        window.removeEventListener('pointermove', this._pointerHandlers.move);
        window.removeEventListener('pointerup', this._pointerHandlers.up);
        window.removeEventListener('pointercancel', this._pointerHandlers.up);
      }
      this._pointerHandlers = null;
    }
    this._selectedIndex = null;
    this._selectionListener = null;
    this._highlight = null;         // 几何已随 _clearBlueprintObjects() 里的 _clearHighlight() 释放
    this._pickRay = null;
    this._scene = null;
    this._camera = null;
  }
}

export { FactoryPreview };
