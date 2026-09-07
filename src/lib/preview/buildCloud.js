/**
 * 戴森云单条轨道渲染对象构建
 *
 * @param {object} orb   - cloud.orbits 项（id/radius/四元数）
 * @param {object} color - 轨道颜色
 * @param {number} scale - 缩放系数
 * @returns {THREE.Group} 环 + 光晕组
 */
import * as THREE from 'three';
import { _toHexColor, _createOrbitRing, _createOrbitGlow } from './geometry.js';

export function buildCloudOrbit(orb, color, scale) {
  const colorHex = _toHexColor(color, 0xffcba6);
  const r = orb.radius * scale;
  const group = new THREE.Group();
  const ring = _createOrbitRing(r, orb, colorHex, 0.9);
  group.add(ring);
  const glow = _createOrbitGlow(r, orb, colorHex, 0.18);
  group.add(glow);
  return group;
}
