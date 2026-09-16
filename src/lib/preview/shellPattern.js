/**
 * shellPattern — 壳面图案（游戏贴图）
 *
 * 只画图案，不碰六边形细胞结构（见 buildShellCells.js）。
 * 贴图取自游戏材质 dyson-shell-unlit-N 的 _ColorControlTex2（每图案一张线蒙版）。
 * uv 与游戏一致: u = x/3、v = x/6 + (0.5/√3)·y（x、y 以细胞内切半径为单位），
 * 再加格坐标偏移 ((2m-n)/3, (m+n)/3) ⇒ 每格一个 tile 且跨格连续；
 * 这些量由 buildShellCells 写进 aPatternUV / aPatternMN。
 */
import * as THREE from 'three';
// 图案线蒙版贴图（取自游戏材质 _ColorControlTex2）
import tex0 from '../../assets/shell-textures/dyson-shell-unlit-0.png';
import tex1 from '../../assets/shell-textures/dyson-shell-unlit-1.png';
import tex2 from '../../assets/shell-textures/dyson-shell-unlit-2.png';
import tex3 from '../../assets/shell-textures/dyson-shell-unlit-3.png';
import tex4 from '../../assets/shell-textures/dyson-shell-unlit-4.png';
import tex5 from '../../assets/shell-textures/dyson-shell-unlit-5.png';
import tex6 from '../../assets/shell-textures/dyson-shell-unlit-6.png';

const PATTERN_TEXTURES = [tex0, tex1, tex2, tex3, tex4, tex5, tex6];

// 每个图案一张线蒙版: 中性灰、峰值 1.0，边缘过渡比发光图更细腻
const PATTERN_COUNT = 7;
// 图案线覆盖率差别大（2.75%~16.32%），按覆盖率补增益把各图案平均亮度拉平
const PATTERN_GAIN = [1.67, 2.5, 2.5, 0.83, 2.17, 1.67, 1.25];   // 取自游戏材质的 _EmissionMultiplier（2.0/3.0/3.0/1.0/2.6/2.0/1.5），整体均值归一到与原表一致

// 观感常数
const INNER_DIM = 0.1;   // 细胞内部（图案线之外）压暗到面颜色的比例（底色压暗，贴近游戏的深底）
const WALL_GAIN = 2.0;    // 图案线提亮倍数（漫反射部分）
// 线另加一层自发光（游戏里线是 HDR 发光的，预览无 bloom，只靠漫反射会发灰）
const PATTERN_GLOW = 1.1;
const MASK_LOW = 0.155;   // 蒙版贴图 → 线蒙版的归一化窗口（贴图线是软边，窗口窄一点线才清楚）
const MASK_HIGH = 1.0;    // 该贴图峰值 = 1.0，所以上界就是 1
// 细网复用图案 0 的贴图
const FINE_MASK_LOW = 0.1;
const FINE_MASK_HIGH = 0.28;
const FINE_GAIN = 1.6;    // 细网线亮度倍数
const FINE_GLOW = 1.0;    // 细网线自发光强度（图案线是 PATTERN_GLOW）
// 距离降级（对应 viewDistFalloff）: 底色回升早、图案收拢晚
const INNER_FADE_START = 0.04;   // 一个像素跨 0.04 个细胞（≈25px 一格）开始回升
const INNER_FADE_END = 0.22;     // ≈4.5px 一格时已完成回升
// 图案/细网收拢（可以晚）: 让图案在更远的距离仍可见，和游戏的观感一致
const FALLOFF_START = 0.15;      // ≈6.7px 一格图案开始收拢
const FALLOFF_END = 0.9;         // ≈1.1px 一格完全收拢
const FALLOFF_INNER_DIM = 0.95;  // 完全降级时底色 = 本色的 95%

const dummyBlack = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
dummyBlack.needsUpdate = true;

const textures = new Map();      // pattern → Texture（线蒙版）
let fineTexture = null;          // 共有贴图 _EmissionTex（细胞点细网）
const pendingMaterials = new Set();
const readyCallbacks = new Set();
let state = 'idle';              // idle | loading | done

function loadTexture(url) {
  return new Promise((resolve) => {
    new THREE.TextureLoader().load(
      url,
      (tex) => {
        tex.colorSpace = THREE.NoColorSpace;  // 蒙版/发光按原始数值采样
        // 上下方向
        tex.flipY = true;
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.anisotropy = 16;                  // 壳面多为斜视，没有各向异性过滤会糊成条状
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = true;
        resolve(tex);
      },
      undefined,
      () => resolve(null),
    );
  });
}

async function loadPatternTextures(pattern) {
  const url = PATTERN_TEXTURES[pattern];
  return url ? loadTexture(url) : null;
}

/** 开始（或已完成时立即回调）加载图案贴图 */
export function ensureShellPatternTextures(onReady) {
  if (typeof document === 'undefined') { state = 'done'; if (onReady) onReady(); return; }
  if (state === 'done') { if (onReady) onReady(); return; }
  if (state === 'loading') return;
  state = 'loading';
  const jobs = [];
  for (let p = 0; p < PATTERN_COUNT; p += 1) {
    jobs.push(loadPatternTextures(p).then((tex) => { if (tex) textures.set(p, tex); }));
  }
  Promise.all(jobs).then(() => {
    state = 'done';
    // 细网复用图案 0 的贴图（同形，只是采样尺度不同）
    fineTexture = textures.get(0) || null;
    for (const mat of pendingMaterials) {
      const pat = mat.userData.shellPatternId ?? 0;
      if (textures.get(pat)) bindPatternTexture(mat, pat);
    }
    pendingMaterials.clear();
    for (const cb of readyCallbacks) { try { cb(); } catch { /* 忽略回调异常 */ } }
    readyCallbacks.clear();
    if (onReady) onReady();
  });
}

/** 注册"贴图加载完成"回调（预览用它强制重画一帧） */
export function onShellPatternReady(cb) {
  if (state === 'done') { cb(); return; }
  readyCallbacks.add(cb);
}

function bindPatternTexture(material, pattern) {
  const u = material.userData.shellPatternUniforms;
  if (!u) return;
  const tex = textures.get(pattern);
  u.uPatternEmis.value = tex || dummyBlack;
  u.uHasPattern.value = tex ? 1 : 0;
  u.uMaskLow.value = MASK_LOW;
  u.uMaskHigh.value = MASK_HIGH;
  u.uFineTex.value = fineTexture || dummyBlack;
  u.uHasFine.value = (fineTexture && material.userData.shellUseFine !== false) ? 1 : 0;
  material.needsUpdate = true;
}

/**
 * 给细胞材质挂上壳面图案（贴图 + 着色器补丁）
 *
 * 需要的顶点属性（由 buildShellCells 写入）:
 *   aPatternUV vec2 — 该顶点在细胞内的图案 uv（已含格坐标偏移，可直接采样）
 *   aPatternMN vec2 — 该细胞所属格点系数 (m,n)（保留给后续扩展，例如细胞点细网）
 *
 * @param {THREE.Material} material 细胞材质（会就地打补丁）
 * @param {{ pattern?: number }} [options]
 */
export function applyShellPattern(material, options = {}) {
  if (!material || material.userData.shellPattern) return material;
  const pattern = options.pattern ?? 0;
  material.userData.shellPattern = true;
  material.userData.shellPatternId = pattern;
  // 是否画细胞点细网（背面不画，只有图案）
  material.userData.shellUseFine = options.useFine !== false;

  const uniforms = {
    uPatternEmis: { value: dummyBlack },
    uHasPattern: { value: 0 },
    uMaskLow: { value: MASK_LOW },
    uMaskHigh: { value: MASK_HIGH },
// 逐像素涂色: 涂色烘成"方向→颜色"立方体贴图，图案再压在其上
    uPaintCube: { value: null },
    uHasPaint: { value: 0 },
    // 细胞点细网: 共有贴图 + gridScale（决定细网在一个细胞里重复几次）
    uFineTex: { value: dummyBlack },
    uHasFine: { value: 0 },
    uGridScale: { value: 1 },
    uPatternGain: { value: 1 },
  };
  material.userData.shellPatternUniforms = uniforms;
  uniforms.uGridScale.value = options.gridScale || 1;
  uniforms.uPatternGain.value = PATTERN_GAIN[pattern] ?? 1;

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec2 aPatternUV;
attribute vec2 aPatternMN;
varying vec2 vPatternUV;
varying vec2 vPatternMN;
varying vec3 vShellLocalDir;
`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vPatternUV = aPatternUV;
vPatternMN = aPatternMN;
vShellLocalDir = normalize(position);
`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec2 vPatternUV;
varying vec2 vPatternMN;
varying vec3 vShellLocalDir;
uniform sampler2D uPatternEmis;
uniform float uHasPattern;
uniform float uMaskLow;
uniform float uMaskHigh;
uniform samplerCube uPaintCube;
uniform float uHasPaint;
uniform sampler2D uFineTex;
uniform float uHasFine;
uniform float uGridScale;
uniform float uPatternGain;
// 图案线蒙版与线颜色（在 <color_fragment> 里算
float gPatternMask = 0.0;
float gFineMask = 0.0;
vec3 gPatternLineColor = vec3(0.0);
vec3 gFineLineColor = vec3(0.0);
`)
      .replace('#include <color_fragment>', `#include <color_fragment>
// ① 先涂色: 逐像素按方向取涂色（a=0 表示这一格没涂，保留面颜色）
if (uHasPaint > 0.5) {
  vec4 paint = textureCube(uPaintCube, vShellLocalDir);
  diffuseColor.rgb = mix(diffuseColor.rgb, paint.rgb, paint.a);
}
// 细胞局部 uv（±1/3 对应一个细胞），去掉格坐标偏移即得
vec2 localUV = vPatternUV - vec2((-2.0 * vPatternMN.x + vPatternMN.y) / 3.0,
                                 -(vPatternMN.x + vPatternMN.y) / 3.0);
// 线色统一以压暗前的底色为基准，INNER_DIM 只影响细胞内部
vec3 baseColor = diffuseColor.rgb;
// 一个像素跨多少细胞: innerLod 管底色回升、maskLod 管图案收拢
float cellSpan = max(fwidth(localUV.x), fwidth(localUV.y)) * 3.0;
float innerLod = smoothstep(${INNER_FADE_START.toFixed(4)}, ${INNER_FADE_END.toFixed(4)}, cellSpan);
float maskLod = smoothstep(${FALLOFF_START.toFixed(4)}, ${FALLOFF_END.toFixed(4)}, cellSpan);
if (uHasPattern > 0.5) {
  // 图案线蒙版: 发光贴图的实测峰值 ≈ 0.38
  float patternMask = smoothstep(uMaskLow, uMaskHigh,
                                 texture2D(uPatternEmis, vPatternUV).r) * (1.0 - maskLod);
  // 线 = 面/涂色颜色 × 提亮倍数 × 图案增益
  vec3 lineColor = baseColor * ${WALL_GAIN.toFixed(4)} * uPatternGain;
  vec3 innerColor = baseColor * mix(${INNER_DIM.toFixed(4)}, ${FALLOFF_INNER_DIM.toFixed(4)}, innerLod);
  diffuseColor.rgb = mix(innerColor, min(lineColor, vec3(1.0)), patternMask);
  gPatternMask = patternMask;
  gPatternLineColor = lineColor;
}
// 细胞点细网: 采样 uv = 局部 uv × gridScale
if (uHasFine > 0.5) {
  // 细网线比图案线细 gridScale 倍
  float fineLod = smoothstep(${FALLOFF_START.toFixed(4)} * uGridScale,
                             ${FALLOFF_END.toFixed(4)} * uGridScale, cellSpan);
  float fineMask = smoothstep(${FINE_MASK_LOW.toFixed(4)}, ${FINE_MASK_HIGH.toFixed(4)},
                              texture2D(uFineTex, localUV * uGridScale).r) * (1.0 - max(maskLod, fineLod));
  vec3 fineLine = baseColor * ${FINE_GAIN.toFixed(4)};
  diffuseColor.rgb = mix(diffuseColor.rgb, min(fineLine, vec3(1.0)), fineMask);
  gFineMask = fineMask;
  gFineLineColor = fineLine;
}
`)
// 线再叠一层自发光，注入在 <opaque_fragment> 之前
      .replace('#include <opaque_fragment>', `outgoingLight += gPatternLineColor * (gPatternMask * ${PATTERN_GLOW.toFixed(4)})
              + gFineLineColor * (gFineMask * ${FINE_GLOW.toFixed(4)});
#include <opaque_fragment>`);
  };

  if (textures.get(pattern)) bindPatternTexture(material, pattern);
  else if (state !== 'done') { pendingMaterials.add(material); ensureShellPatternTextures(); }
  material.needsUpdate = true;
  return material;
}

/**
 * 给某个壳层的细胞材质挂上"涂色立方体贴图"（A+ 方案）
 * @param {THREE.Object3D} cellRoot 细胞板（buildShellCells 返回的 Group）
 * @param {THREE.CubeTexture|null} cube 由烘涂色得到的方向→颜色贴图
 */
export function applyShellPainting(cellRoot, cube) {
  if (!cellRoot) return;
  cellRoot.traverse((obj) => {
    const u = obj.material?.userData?.shellPatternUniforms;
    if (!u) return;
    u.uPaintCube.value = cube || null;
    u.uHasPaint.value = cube ? 1 : 0;
    obj.material.needsUpdate = true;
  });
}

/**
 * 把涂色网格烘成"方向 → 颜色"的立方体贴图（A+ 方案）
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Object3D} paintingGroup buildPainting() 的结果
 * @param {number} [size] 每个面的分辨率（1024 ⇒ 角分辨率约 0.09°，约 1/6 个图案格）
 * @returns {THREE.CubeTexture|null}
 */
export function bakeShellPainting(renderer, paintingGroup, size = 1024) {
  if (!renderer || !paintingGroup) return null;
  const rt = new THREE.WebGLCubeRenderTarget(size, {
    format: THREE.RGBAFormat,
// 不要 mipmap: 立方体渲染目标的 mip 不会自动生成，会采到黑层
    generateMipmaps: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });
  const camera = new THREE.CubeCamera(0.01, 10, rt);
  const scene = new THREE.Scene();
  scene.add(paintingGroup);

  // 烘的过程中不能把预览的底色/色调映射带进去：涂色是"数据"，要原样写进贴图
  const prevColor = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  const prevToneMapping = renderer.toneMapping;
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.NoToneMapping;
  camera.update(renderer, scene);
  renderer.setClearColor(prevColor, prevAlpha);
  renderer.toneMapping = prevToneMapping;
  scene.remove(paintingGroup);
  return rt.texture;
}
