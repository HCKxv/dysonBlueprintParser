/**
 * buildCloud — 戴森云轨道渲染对象构建（由 preview.js render() 调用）
 *
 * 纯构建函数，通过 ctx 注入宿主资源，不依赖 DysonSpherePreview 实例。
 * @param {object} cloud - parsed.body.dysonCloud
 * @param {object} ctx   - { root: THREE.Group, vis: Map, scale: number }
 */
import * as THREE from 'three';
import { _toHexColor, _createOrbitRing, _createOrbitGlow } from './geometry.js';

export function buildCloudOrbits(cloud, ctx) {
  if (!cloud?.orbits) return;
  cloud.orbits.forEach((orb, idx) => {
    if (!orb) return;
    const gv = cloud.visibility ? cloud.visibility.inGame[orb.id] : true;
    const r = orb.radius * ctx.scale;
    const e = cloud.colors?.[orb.id] ?? cloud.colors?.[orb.id - 1] ?? cloud.colors?.[idx];
    const ring = _createOrbitRing(r, orb, _toHexColor(e, 0xffcba6), 0.9);
    ring.name = 'cloud-orbit-' + idx; ring.visible = gv;
    ctx.vis.set('cloud_' + orb.id, ring); ctx.root.add(ring);
    const glow = _createOrbitGlow(r, orb, _toHexColor(e, 0xffcba6), 0.18);
    glow.name = 'cloud-glow-' + idx; glow.visible = gv;
    ctx.vis.set('cloud_glow_' + orb.id, glow); ctx.root.add(glow);
  });
}
