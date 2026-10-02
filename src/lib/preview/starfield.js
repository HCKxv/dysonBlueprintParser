/**
 * 星空背景（球体预览与工厂预览共用同一份代码）:
 * 半径 60 的球面上铺三层星点 + 少量光晕亮星；星点 sizeAttenuation: false，屏幕像素大小固定，当天空盒看。
 *
 * 用法: scene.add(createStarfield(pixelRatio, seed))；销毁时 disposeStarfield(group)。
 */
import * as THREE from 'three';

/** 星空模式下的场景底色（和星空一起用） */
export const STARFIELD_BG_COLOR = 0x070d1a;

/** 星点铺在这个半径的球面上: 要大过任何场景物体的包围球，又得留在相机远裁剪面以内 */
const STARFIELD_RADIUS = 60;

/** 三层星点: 不同大小 / 数量 / 亮度，模拟远近层次 */
const STAR_LAYERS = [
  { count: 130, size: 1.8, minBright: 0.5 },
  { count: 380, size: 1.3, minBright: 0.32 },
  { count: 850, size: 0.9, minBright: 0.18 },
];

/** 星色: 白 / 冷蓝 / 暖黄 / 淡蓝 / 淡橙（按权重抽取） */
const STAR_PALETTE = [0xffffff, 0xd9e6ff, 0xfff0d6, 0xbcd6ff, 0xffe2b8];
const STAR_WEIGHTS = [6, 3, 2, 2, 1];

/** 整体亮度压低一点，星空更柔和 */
const STAR_BRIGHTNESS = 0.55;

/** 带光晕的亮星数量 */
const BRIGHT_STAR_COUNT = 6;

/**
 * 建一组星空。
 * @param {number} [pixelRatio] 渲染器像素比 —— 星点大小按它缩放，换块屏幕不至于变糊或变粗
 * @param {number} [seed] 星空种子: 同一颗种子生成同一片星空
 * @returns {THREE.Group} 直接 scene.add；显隐改 group.visible
 */
export function createStarfield(pixelRatio = 1, seed = 0) {
  const group = new THREE.Group();
  group.name = 'starfield';

  // 种子随机数，保证每次初始化生成相同的星空
  let state = seed;
  const rand = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
  let totalWeight = 0;
  for (const weight of STAR_WEIGHTS) totalWeight += weight;
  const pickColor = () => {
    let r = rand() * totalWeight;
    for (let i = 0; i < STAR_WEIGHTS.length; i += 1) {
      r -= STAR_WEIGHTS[i];
      if (r < 0) return STAR_PALETTE[i];
    }
    return STAR_PALETTE[0];
  };
  /** 球面上的均匀随机方向（先抽 u 再抽 theta，与旧版取数顺序一致，星空才不会变样） */
  const randomDirection = () => {
    const u = rand() * 2 - 1;
    const theta = rand() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    return [r * Math.cos(theta), u, r * Math.sin(theta)];
  };

  for (const layer of STAR_LAYERS) {
    const positions = new Float32Array(layer.count * 3);
    const colors = new Float32Array(layer.count * 3);
    for (let i = 0; i < layer.count; i += 1) {
      const [x, y, z] = randomDirection();
      positions[i * 3] = x * STARFIELD_RADIUS;
      positions[i * 3 + 1] = y * STARFIELD_RADIUS;
      positions[i * 3 + 2] = z * STARFIELD_RADIUS;
      const bright = (layer.minBright + (1 - layer.minBright) * rand()) * STAR_BRIGHTNESS;
      const color = new THREE.Color(pickColor()).multiplyScalar(bright);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    group.add(new THREE.Points(geometry, new THREE.PointsMaterial({
      size: layer.size * pixelRatio,
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: false,
    })));
  }

  // 少量亮星 + 光晕 Sprite（数量、尺寸、亮度都已压低）
  const glowTexture = createGlowTexture();
  const brightRadius = STARFIELD_RADIUS - 2;
  for (let i = 0; i < BRIGHT_STAR_COUNT; i += 1) {
    const [x, y, z] = randomDirection();
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture,
      color: new THREE.Color(pickColor()).multiplyScalar(0.7),
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));
    sprite.position.set(x * brightRadius, y * brightRadius, z * brightRadius);
    const size = 0.6 + rand() * 0.8;
    sprite.scale.set(size, size, 1);
    group.add(sprite);
  }
  return group;
}

/** 释放 createStarfield 建出来的东西（亮星共用一张光晕贴图，重复 dispose 无害） */
export function disposeStarfield(group) {
  if (!group) return;
  group.traverse((object) => {
    object.geometry?.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      material?.map?.dispose();
      material?.dispose();
    }
  });
}

/** 径向渐变光晕纹理（供亮星 Sprite 使用） */
function createGlowTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.12)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  return texture;
}
