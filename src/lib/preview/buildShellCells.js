/** 六边形细胞板：按游戏点阵生成，裁剪到各自壳面多边形内。 */
import * as THREE from 'three';
import { _edgeKey, _toHexColor, _refineFaceBoundary } from './geometry.js';
import { applyShellPattern } from './shellPattern.js';

const BASE_GRID_SIZE = 80; // 与 DysonShell.GenerateGeometry 一致
const SQRT3 = Math.sqrt(3);
const SQRT3_HALF = SQRT3 / 2;

const CELL_GAP_SCALE = 0.98; // 六边形缩放，留出透明缝隙
const BOUNDARY_GEO_SEGMENTS = 5;
const BOUNDARY_GRID_SEGMENTS = 9;

// 图案 uv 的 v 系数: v = x/6 + (0.5/√3)·y（坐标以"细胞内切半径"为单位）
const PATTERN_UV_VY = 0.5 / Math.sqrt(3);

export function getShellCellGridScale(radius) {
  const r = Math.max(1, Number(radius) || 1);
  return Math.max(1, Math.floor(Math.pow(r / 4000.0, 0.75) + 0.5));
}

function getShellCellGridSize(radius, scale = 1) {
  return getShellCellGridScale(radius) * BASE_GRID_SIZE * scale;
}

// 壳面中心切平面；centerDirOverride 为框架加权中心
function _buildFaceTangentBasis(points, centerDirOverride) {
  const centerDir = centerDirOverride
    ? centerDirOverride.clone()
    : points.reduce((acc, p) => acc.add(p), new THREE.Vector3());
  if (centerDir.lengthSq() < 1e-12) centerDir.copy(points[0] || new THREE.Vector3(1, 0, 0));
  centerDir.normalize();

  const radius = points.reduce((sum, p) => sum + p.length(), 0) / Math.max(1, points.length);
  const up = new THREE.Vector3(0, 1, 0);
  const xAxis = new THREE.Vector3().crossVectors(centerDir, up);
  if (xAxis.lengthSq() < 1e-8) xAxis.set(0, 0, 1);
  xAxis.normalize();
  const yAxis = new THREE.Vector3().crossVectors(centerDir, xAxis).normalize();
  return {
    center: centerDir.clone().multiplyScalar(radius),
    centerDir,
    radius,
    xAxis,
    yAxis,
  };
}

function _projectToTangent(p, basis) {
  // gnomonic 投影，与 _tangentToSphere 互逆
  const dir = p.clone().normalize();
  const denom = dir.dot(basis.centerDir);
  const k = basis.radius / (Math.abs(denom) > 1e-8 ? denom : 1e-8);
  return { x: k * dir.dot(basis.xAxis), y: k * dir.dot(basis.yAxis) };
}

function _tangentToSphere(lx, ly, radius, basis) {
  const px = basis.center.x + basis.xAxis.x * lx + basis.yAxis.x * ly;
  const py = basis.center.y + basis.xAxis.y * lx + basis.yAxis.y * ly;
  const pz = basis.center.z + basis.xAxis.z * lx + basis.yAxis.z * ly;
  const inv = radius / Math.sqrt(px * px + py * py + pz * pz);
  return new THREE.Vector3(px * inv, py * inv, pz * inv);
}

function _polygonArea2(poly) {
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

function _ensureCcw(poly) {
  return _polygonArea2(poly) < 0 ? poly.slice().reverse() : poly;
}

function _dedupePolygon(poly, eps = 1e-9) {
  const out = [];
  for (const p of poly) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last.x - p.x) + Math.abs(last.y - p.y) > eps) out.push(p);
  }
  if (out.length > 1) {
    const first = out[0], last = out[out.length - 1];
    if (Math.abs(first.x - last.x) + Math.abs(first.y - last.y) <= eps) out.pop();
  }
  return out;
}

// Sutherland-Hodgman 凸多边形裁剪
function _clipConvex(subject, clip) {
  let out = subject;
  const eps = 1e-10;
  for (let i = 0; i < clip.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length];
    const abx = b.x - a.x, aby = b.y - a.y;
    const side = p => abx * (p.y - a.y) - aby * (p.x - a.x);
    const input = out;
    out = [];
    if (!input.length) return out;
    for (let j = 0; j < input.length; j++) {
      const prev = input[(j - 1 + input.length) % input.length];
      const cur = input[j];
      const prevSide = side(prev);
      const curSide = side(cur);
      const prevIn = prevSide >= -eps;
      const curIn = curSide >= -eps;
      if (curIn) {
        if (!prevIn) {
          const t = prevSide / (prevSide - curSide || 1e-12);
          out.push({ x: prev.x + t * (cur.x - prev.x), y: prev.y + t * (cur.y - prev.y) });
        }
        out.push(cur);
      } else if (prevIn) {
        const t = prevSide / (prevSide - curSide || 1e-12);
        out.push({ x: prev.x + t * (cur.x - prev.x), y: prev.y + t * (cur.y - prev.y) });
      }
    }
    if (out.length < 3) return out;
  }
  return out;
}

function _isConvexPolygon(poly) {
  let sign = 0;
  const eps = 1e-10;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], c = poly[(i + 2) % poly.length];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (cross > eps) {
      if (sign < 0) return false;
      sign = 1;
    } else if (cross < -eps) {
      if (sign > 0) return false;
      sign = -1;
    }
  }
  return true;
}

function _bboxOverlap(a, b) {
  return !(a.maxX < b.minX || b.maxX < a.minX || a.maxY < b.minY || b.maxY < a.minY);
}

function _makeBBox(poly) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

// 凹多边形用 earcut 三角化
function _triangulatePolygon(poly) {
  const points = poly.map(p => new THREE.Vector2(p.x, p.y));
  const triIndices = THREE.ShapeUtils.triangulateShape(points, []);
  const triangles = [];
  if (!Array.isArray(triIndices)) return triangles;
  for (const tri of triIndices) {
    if (!Array.isArray(tri) || tri.length < 3) continue;
    const pts = [];
    for (const i of tri) if (poly[i]) pts.push(poly[i]);
    if (pts.length < 3) continue;
    if (_polygonArea2(pts) < 0) pts.reverse();
    triangles.push({ points: pts, bbox: _makeBBox(pts) });
  }
  return triangles;
}

// 候选点预筛：中心在多边形内或靠近边界
function _pointInPolygon(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > py) !== (b.y > py) && px < (b.x - a.x) * (py - a.y) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function _distanceSqToSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay;
  const apx = px - ax, apy = py - ay;
  const t = (apx * abx + apy * aby) / (abx * abx + aby * aby || 1e-12);
  const cx = ax + Math.min(1, Math.max(0, t)) * abx;
  const cy = ay + Math.min(1, Math.max(0, t)) * aby;
  const dx = px - cx, dy = py - cy;
  return dx * dx + dy * dy;
}

function _isCandidateCenterUseful(cx, cy, poly, maxDistSq) {
  if (_pointInPolygon(cx, cy, poly)) return true;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    if (_distanceSqToSegment(cx, cy, a.x, a.y, b.x, b.y) <= maxDistSq) return true;
  }
  return false;
}

// 游戏点阵的六个相邻方向: w0, w1, -w2, -w0, -w1, w2
const NEIGHBOR_DIRS = [
  { x: 1, y: 0 },
  { x: 0.5, y: -SQRT3_HALF },
  { x: -0.5, y: -SQRT3_HALF },
  { x: -1, y: 0 },
  { x: -0.5, y: SQRT3_HALF },
  { x: 0.5, y: SQRT3_HALF },
];
// 从 -60° 开始按逆时针取相邻方向，两两平均即六边形顶点
const HEX_CORNER_ORDER = [1, 0, 5, 4, 3, 2];

function _makeHexCorners(cx, cy, gridSize) {
  const corners = [];
  const s = gridSize / 3;
  for (let i = 0; i < 6; i++) {
    const a = NEIGHBOR_DIRS[HEX_CORNER_ORDER[i]];
    const b = NEIGHBOR_DIRS[HEX_CORNER_ORDER[(i + 1) % 6]];
    corners.push({ x: cx + (a.x + b.x) * s * CELL_GAP_SCALE, y: cy + (a.y + b.y) * s * CELL_GAP_SCALE });
  }
  return corners;
}

function _forEachLatticeInBounds(poly, gridSize, callback) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  // 外扩一个格距，覆盖边界细胞板
  minX -= gridSize; minY -= gridSize; maxX += gridSize; maxY += gridSize;
  const rowH = gridSize * SQRT3_HALF;
  const nMin = Math.floor(minY / rowH) - 2;
  const nMax = Math.ceil(maxY / rowH) + 2;
  for (let n = nMin; n <= nMax; n++) {
    const y = n * rowH;
    const xOffset = -n * gridSize * 0.5;
    const mMin = Math.ceil((minX - xOffset) / gridSize) - 2;
    const mMax = Math.floor((maxX - xOffset) / gridSize) + 2;
    for (let m = mMin; m <= mMax; m++) {
      callback(m, n, m * gridSize + xOffset, y);
    }
  }
}

// 将 subject 多边形裁剪到壳面多边形内；凸壳面直接裁剪，凹壳面逐三角形裁剪
function _forEachClippedPiece(subject, clip, convexClip, clipTriangles, subjectBBox, callback) {
  if (convexClip) {
    callback(_dedupePolygon(_clipConvex(subject, clip)));
    return;
  }
  if (clipTriangles?.length) {
    for (const tri of clipTriangles) {
      if (!_bboxOverlap(subjectBBox, tri.bbox)) continue;
      callback(_dedupePolygon(_clipConvex(subject, tri.points)));
    }
    return;
  }
  callback(_dedupePolygon(_clipConvex(subject, clip)));
}

export function buildShellCells(shData, nodeMap, shPole, ftMap, orbit, scale, stencilRef) {
  // 按图案分组累积（一个材质只能采样一套图案贴图；同一壳面可以混用多种图案）
  const buckets = new Map();   // pattern → 几何缓冲
  const bucketOf = (pattern) => {
    let b = buckets.get(pattern);
    if (!b) {
      b = { positions: [], normals: [], colors: [], indices: [], patternUV: [], patternMN: [] };
      buckets.set(pattern, b);
    }
    return b;
  };
  const gridSize = getShellCellGridSize(orbit.radius, scale);
  if (!shData.faces?.length || gridSize <= 0) return null;
  const color = new THREE.Color();
  const minPieceArea = gridSize * gridSize * 1e-7;
  // 图案 uv 以画出来的细胞内切半径为基准，使贴图里的六边形环落在细胞边上
  const cellInradius = gridSize * 0.5 * CELL_GAP_SCALE;
  const invCellRadius = 1 / cellInradius;

  shData.faces.forEach(fc => {
    if (!fc || !Array.isArray(fc.relation) || fc.relation.length < 3) return;
    if (fc.relation.some(nid => !nodeMap.has(nid))) return;
    const rel = fc.relation.slice();
    const pts = rel.map(nid => nodeMap.get(nid));
    if (pts.some(p => !p)) return;
    const edgeTypes = rel.map((_, j) => ftMap.get(_edgeKey(rel[j], rel[(j + 1) % rel.length])) ?? 0);
    const boundary = _refineFaceBoundary(pts, shPole, edgeTypes, BOUNDARY_GEO_SEGMENTS, BOUNDARY_GRID_SEGMENTS);
    if (boundary.length < 3) return;

    const frameCenter = new THREE.Vector3();
    const mid = new THREE.Vector3();
    let frameWeight = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const len = a.distanceTo(b);
      mid.addVectors(a, b).multiplyScalar(0.5);
      frameCenter.addScaledVector(mid, len);
      frameWeight += len;
    }
    if (frameWeight > 1e-12) frameCenter.multiplyScalar(1 / frameWeight).normalize();

    const basis = _buildFaceTangentBasis(boundary, frameWeight > 1e-12 ? frameCenter : null);
    const tangentBoundary = boundary.map(p => _projectToTangent(p, basis));
    const clip = _ensureCcw(tangentBoundary);
    const convexClip = _isConvexPolygon(clip);
    const clipTriangles = convexClip ? null : _triangulatePolygon(clip);
    color.setHex(_toHexColor(fc.color, 0x175473));

    const pattern = (fc.pattern | 0) || 0;
    const buf = bucketOf(pattern);

    const maxUsefulDist = gridSize * (CELL_GAP_SCALE / SQRT3 + 0.25);
    const maxUsefulDistSq = maxUsefulDist * maxUsefulDist;

    _forEachLatticeInBounds(clip, gridSize, (m, n, cx, cy) => {
      if (!_isCandidateCenterUseful(cx, cy, clip, maxUsefulDistSq)) return;
      const corners = _makeHexCorners(cx, cy, gridSize);
      const hexBBox = _makeBBox(corners);

      const cellCenterWorld = _tangentToSphere(cx, cy, basis.radius, basis);
      const nx = cellCenterWorld.x / basis.radius;
      const ny = cellCenterWorld.y / basis.radius;
      const nz = cellCenterWorld.z / basis.radius;

      // 图案 uv 的格坐标偏移: 每格一个 tile
      const patternOffU = (-2 * m + n) / 3;
      const patternOffV = -(m + n) / 3;

      const addPiece = piece => {
        if (piece.length < 3) return;
        const pieceArea = _polygonArea2(piece);
        if (Math.abs(pieceArea) < minPieceArea) return;
        if (pieceArea < 0) piece.reverse();
        const base = buf.positions.length / 3;
        for (let i = 0; i < piece.length; i++) {
          const p = _tangentToSphere(piece[i].x, piece[i].y, basis.radius, basis);
          buf.positions.push(p.x, p.y, p.z);
          buf.normals.push(nx, ny, nz);
          buf.colors.push(color.r, color.g, color.b);
// 图案 uv: 本坐标系相对游戏整体旋转 180°，故 x/y 项取负
          const rx = (piece[i].x - cx) * invCellRadius;
          const ry = (piece[i].y - cy) * invCellRadius;
          buf.patternUV.push(-rx / 3 + patternOffU, -rx / 6 - PATTERN_UV_VY * ry + patternOffV);
          buf.patternMN.push(m, n);
        }
        for (let i = 1; i < piece.length - 1; i++) {
          buf.indices.push(base, base + i, base + i + 1);
        }
      };

      _forEachClippedPiece(corners, clip, convexClip, clipTriangles, hexBBox, addPiece);
    });
  });

  const group = new THREE.Group();
  group.name = 'shellCells';
  for (const [pattern, buf] of buckets) {
    if (!buf.positions.length) continue;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(buf.positions, 3));
    geom.setAttribute('normal', new THREE.Float32BufferAttribute(buf.normals, 3));
    geom.setAttribute('color', new THREE.Float32BufferAttribute(buf.colors, 3));
    geom.setAttribute('aPatternUV', new THREE.Float32BufferAttribute(buf.patternUV, 2));
    geom.setAttribute('aPatternMN', new THREE.Float32BufferAttribute(buf.patternMN, 2));
    geom.setIndex(buf.indices);

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      side: THREE.FrontSide,
      depthWrite: true,
      metalness: 0.25,
      roughness: 0.55,
    });
    // 壳面图案（游戏贴图）+ 细胞点细网: gridScale 决定细网在一个细胞里重复几次
    applyShellPattern(mat, { pattern, gridScale: getShellCellGridScale(orbit.radius) });
    // 写本层 stencil，供涂色层裁剪
    mat.stencilWrite = true;
    mat.stencilWriteMask = 0xff;
    mat.stencilRef = stencilRef;
    mat.stencilFunc = THREE.AlwaysStencilFunc;
    mat.stencilZPass = THREE.ReplaceStencilOp;

    const mesh = new THREE.Mesh(geom, mat);
    mesh.name = `shellCells:${pattern}`;
    mesh.userData.shellPattern = pattern;
    mesh.frustumCulled = false;
    group.add(mesh);
  }
  return group.children.length ? group : null;
}

