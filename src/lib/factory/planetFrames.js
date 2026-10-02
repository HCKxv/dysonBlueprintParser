/**
 * planetFrames — 行星球面预览的**基础几何与单位**（工厂预览的相机与场景共用这一份）
 *
 * 场景约定: 行星半径 = 1、球心在原点，游戏局部坐标 z 取反（纬度 0°、经度 0° 在 +Z 一侧）。
 * 「坐标 → 坐标」的纯换算。相机（cameraRig.js）与场景（FactoryPreview.js）共用
 */

import * as THREE from 'three';

/** 行星半径（场景单位）: 球心在原点，一切距离都按半径 1 计 */
export const PLANET_RADIUS = 1;

export const DEG = Math.PI / 180;

/**
 * 世界单位换算: 1 世界单位 = 1 / (200 + 0.2) 场景单位（可建厂行星 realRadius = 200 固定，
 * 贴地建筑球心距 = 真实半径 + 0.2，场景里球面半径 1 即代表该贴地面）；建筑尺寸一律按世界单位给。
 */
const PLANET_REAL_RADIUS = 200;
const GROUND_OFFSET_GAME_UNITS = 0.2;
export const GAME_UNIT_SCENE = 1 / (PLANET_REAL_RADIUS + GROUND_OFFSET_GAME_UNITS);

/** 离地高度: 蓝图的 z 单位是「高度格」（游戏 PlanetGrid.kAltGrid = 4/3 世界单位） */
const ALT_GRID_GAME_UNITS = 4 / 3;
export const ALTITUDE_STEP_SCENE = ALT_GRID_GAME_UNITS * GAME_UNIT_SCENE;

/**
 * 一格赤道弧长（场景单位）: 行星半径 1，赤道一圈 1000 格（游戏 PlanetGrid 的赤道格数）。
 * **与 GAME_UNIT_SCENE 无关**，别混。
 */
export const CELL_SCENE = (Math.PI * 2) / 1000;

/** 游戏局部坐标 → 场景坐标: z 取反（与其它预览层一致），返回新数组 */
export function flipZ(positions) {
  const out = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    out[i] = positions[i];
    out[i + 1] = positions[i + 1];
    out[i + 2] = -positions[i + 2];
  }
  return out;
}

/** 游戏经纬度（度）→ 场景单位方向（游戏 GetDir 的 z 取反） */
export function surfaceDirection(latDeg, lngDeg) {
  const lat = latDeg * DEG;
  const lng = lngDeg * DEG;
  const cosLat = Math.cos(lat);
  return new THREE.Vector3(cosLat * Math.sin(lng), Math.sin(lat), cosLat * Math.cos(lng));
}

/** 当地的「北」方向（切平面内，纬度增大方向）: 单位球面经纬度对纬度求导 */
export function northDirection(latDeg, lngDeg) {
  const lat = latDeg * DEG;
  const lng = lngDeg * DEG;
  const north = new THREE.Vector3(
    -Math.sin(lat) * Math.sin(lng),
    Math.cos(lat),
    -Math.sin(lat) * Math.cos(lng),
  );
  // 极点处退化，随便取一条切向（沿该经线指向赤道）
  if (north.lengthSq() < 1e-8) return new THREE.Vector3(-Math.sin(lng), 0, -Math.cos(lng));
  return north.normalize();
}

/** 场景单位方向 → 游戏经纬度（度）: 「观察点转到哪了」要说成经纬度时用 */
export function directionToLatLng(direction) {
  const normal = direction.clone().normalize();
  return {
    latDeg: Math.asin(THREE.MathUtils.clamp(normal.y, -1, 1)) / DEG,
    lngDeg: Math.atan2(normal.x, normal.z) / DEG,
  };
}
