/**
 * foundationBlueprint.js — 地基彩绘 → 工厂蓝图（地基数据 reformData）
 *
 * 这是游戏「复制地基」那半段流程的移植，算法与取整都按它走: 粘贴侧会从 area 的南边界纬度
 * 和 size 反推格子框再校验，差一行就报「蓝图区域被回归线分割」或「子区域起始坐标不在格子交点上」。
 *
 * 几条容易踩的约定（纬度以「格」为单位，1 格 = 1 行 = 360/(segment*5) 度）：
 *   - 行 j 的南边界 t：北半球 t = row，南半球 t = -(fromEquator+1)，行占 [t, t+1)
 *   - 包围盒 boxSouth = min(涂过行的 t+1)、boxNorth = max(涂过行的 t)
 *   - area 的南边界 s 不是「档的南边界」，见 splitGratBoxInTropicAreas
 *   - rect.y = t - s + 1（北半球首行 y = 0、南半球首行 y = 1，±0.4 的 nudge 决定）
 *   - size.y 决定粘贴时搜索格子框的起点，差 1 行全盘错位
 */

import { determineLongitudeSegmentCount } from '../grid/planetGrid.js'
import { FOUNDATION_NO_COLOR } from './encoder.js'

/**
 * 默认的地基装饰类型
 *   0 = 没有地基（留空），1-6 = 六种装饰花纹，7 = 无装饰（纯地基，游戏复制时默认不勾选）
 */
const DEFAULT_REFORM_TYPE = 2

/** 默认的蓝图头部: 1131 = 地基 */
const DEFAULT_LAYOUT = 10
const DEFAULT_ICONS = [1131, 0, 0, 0, 0]

/** 自定义色在 5 位色号里的起始下标（0-15 是游戏内置色，16-31 是蓝图自带的自定义色） */
const CUSTOM_COLOR_BASE = 16

/** 颜色数量上限（5 位色号） */
const MAX_COLOR_SLOTS = 32

/** 无装饰地基的 data 类型（生成矩形时会写成 224） */
const UNDECAL_REFORM_TYPE = 7

// ─────────────────────────────────────────────────────────────
// 1. 数值工具: 单精度 float / 取整 / 取模
// ─────────────────────────────────────────────────────────────

/** 单精度: 每步算术都落回 float */
const f = Math.fround

const PI = f(Math.PI)
const HALF_PI = f(PI / 2)
const DOUBLE_PI = f(PI * 2)
const POLE_Y = f(0.9999999)
const POLE_XZ_SQR = f(5e-7)
const TROPIC_GRATBOX_LNG_MAX = f(6.2831674)
const TROPIC_OFFSET_RAD_EPSILON = f(0.001)
const NEG_LNG_EPS = f(-1.8e-5)

/** 四舍五入，.5 远离 0（和下面 .5 取偶的那个不是一回事） */
function round2int(d) {
  const v = f(d)
  return v > 0 ? Math.trunc(f(v + 0.5)) : Math.trunc(f(v - 0.5))
}

/** 四舍五入到整数（返回 float） */
function roundFloat(d) {
  const v = f(d)
  return f(v > 0 ? Math.trunc(f(v + 0.5)) : Math.trunc(f(v - 0.5)))
}

/** .5 取偶（引擎行为） */
function mathfRoundToInt(x) {
  const v = f(x)
  const lo = Math.floor(v)
  const diff = v - lo
  if (diff > 0.5) return lo + 1
  if (diff < 0.5) return lo
  return lo % 2 === 0 ? lo : lo + 1
}

/** 取模，结果落在 [0, length) */
function mathfRepeat(t, length) {
  const tt = f(t)
  const len = f(length)
  const v = f(tt - f(Math.floor(f(tt / len)) * len))
  return v < 0 ? 0 : v > len ? len : v
}

/** 符号函数 */
const mathSign = (x) => (f(x) > 0 ? 1 : f(x) < 0 ? -1 : 0)

// ─────────────────────────────────────────────────────────────
// 2. 角度 / 网格换算
// ─────────────────────────────────────────────────────────────

/** GetLatitudeRadPerGrid(_segmentCnt) */
function getLatitudeRadPerGrid(segment) {
  return f(DOUBLE_PI / f(segment * 5))
}

/** GetSnappedLatitudeGridIdx(float _latitudeRad) */
function getSnappedLatitudeGridIdx(latitudeRad, segment) {
  return round2int(f(latitudeRad / getLatitudeRadPerGrid(segment)))
}

/** GetLongitudeSegmentCount(int _latitudeGridIdx)（注意那个 -1） */
function getLongitudeSegmentCountOfIdx(latitudeGridIdx, segment) {
  let i = Math.abs(latitudeGridIdx)
  if (i > 0) i -= 1
  return determineLongitudeSegmentCount(Math.trunc(f(i / 5)), segment)
}

/** GetLongitudeRadPerGrid(int _longitudeSegCnt) */
function getLongitudeRadPerGridOfSegCnt(longitudeSegCnt, segment) {
  return f(DOUBLE_PI / f(longitudeSegCnt * 5))
}

/** GetDir(float _longitudeRad, float _latitudeRad) */
function getDir(longitudeRad, latitudeRad) {
  const lng = f(longitudeRad)
  const lat = f(latitudeRad)
  const y = f(Math.sin(lat))
  const cos = f(Math.cos(lat))
  return {
    x: f(cos * f(Math.sin(lng))),
    y,
    z: f(cos * f(-Math.cos(lng))),
  }
}

/** GetLatitudeRad(Vector3 _npos) */
function getLatitudeRadOfDir(pos) {
  const y = f(pos.y)
  if (y > POLE_Y) return HALF_PI
  if (y < -POLE_Y) return -HALF_PI
  return f(Math.asin(y))
}

/** GetLongitudeRad(Vector3 _npos) */
function getLongitudeRadOfDir(pos) {
  if (f(f(pos.x * pos.x) + f(pos.z * pos.z)) < POLE_XZ_SQR) return 0
  return f(Math.atan2(f(pos.x), f(-pos.z)))
}

/** GetLongitudeSegmentCount(Vector3 _npos) */
function getLongitudeSegmentCountOfDir(pos, segment) {
  return getLongitudeSegmentCountOfIdx(
    getSnappedLatitudeGridIdx(getLatitudeRadOfDir(pos), segment),
    segment,
  )
}

/** GetLongitudeRadPerGrid(Vector3 _npos) */
function getLongitudeRadPerGridOfDir(pos, segment) {
  return getLongitudeRadPerGridOfSegCnt(getLongitudeSegmentCountOfDir(pos, segment), segment)
}

/** GetSnappedLongitudeRad(Vector3 _npos) */
function getSnappedLongitudeRadOfDir(pos, segment) {
  const per = getLongitudeRadPerGridOfDir(pos, segment)
  return f(round2int(f(getLongitudeRadOfDir(pos) / per)) * per)
}

// ─────────────────────────────────────────────────────────────
// 3. BPGratBox（经纬度矩形，弧度）
// ─────────────────────────────────────────────────────────────

const bpGratBox = (x = 0, y = 0, z = 0, w = 0) => ({ x: f(x), y: f(y), z: f(z), w: f(w) })

/** BPGratBox.width */
function bpWidth(b) {
  if (b.z < f(b.x - 1e-5)) return f(f(b.z - b.x) + DOUBLE_PI)
  if (b.z > f(b.x + 1e-5)) return f(b.z - b.x)
  return 0
}

/** BPGratBox.height */
function bpHeight(b) {
  return f(b.w - b.y)
}

/** BPGratBox.Extend(longitude, latitude) */
function bpExtend(b, longitude, latitude) {
  let x = f(b.x)
  let z = f(b.z)
  if (!(z > f(x + 1e-5))) {
    z = !(z < f(x - 1e-5)) ? x : f(z + DOUBLE_PI)
  }
  x = f(x - longitude)
  z = f(z + longitude)
  const width = f(z - x)
  if (width < 0) {
    x = f(f(x + z) / 2)
    z = x
  } else if (width > TROPIC_GRATBOX_LNG_MAX) {
    const half = f(f(width - DOUBLE_PI) / 2)
    x = f(x + half)
    z = x
    x = f(x + 7e-6)
    z = f(z - 7e-6)
  }
  if (x < -PI) x = f(x + DOUBLE_PI)
  else if (x >= PI) x = f(x - DOUBLE_PI)
  if (z < -PI) z = f(z + DOUBLE_PI)
  else if (z >= PI) z = f(z - DOUBLE_PI)
  return { x, y: f(b.y - latitude), z, w: f(b.w + latitude) }
}

/** 纬度方向扩半行 */
function getExtendedGratBox(gratbox, extendLngGrid = 0.5) {
  let per = 0
  if (f(gratbox.y * gratbox.w) > 0 && gratbox.y > 0) per = getLongitudeRadPerGridOfSegCnt(getLongitudeSegmentCountOfIdx(round2int(f(gratbox.y / getLatitudeRadPerGrid(200))), 200), 200)
  else if (f(gratbox.y * gratbox.w) > 0 && gratbox.y < 0) per = getLongitudeRadPerGridOfSegCnt(getLongitudeSegmentCountOfIdx(round2int(f(gratbox.w / getLatitudeRadPerGrid(200))), 200), 200)
  else per = getLongitudeRadPerGridOfSegCnt(determineLongitudeSegmentCount(0, 200), 200)
  // 按默认 200 算（无视传进来的 segment），与游戏一致
  return bpExtend({ ...gratbox }, f(per * f(extendLngGrid)), f(getLatitudeRadPerGrid(200) * f(0.5)))
}

/** 一段纬度范围要切成几个 area */
function getAreaCount(startLatitudeRad, endLatitudeRad, segment) {
  const north = f(Math.max(f(startLatitudeRad), f(endLatitudeRad)))
  const south = f(Math.min(f(startLatitudeRad), f(endLatitudeRad)))
  const idxNorth = getSnappedLatitudeGridIdx(north, segment)
  const idxSouth = getSnappedLatitudeGridIdx(south, segment)
  let count = 1
  let prev = getLongitudeSegmentCountOfIdx(idxSouth, segment)
  for (let i = idxSouth; i < idxNorth; i += 1) {
    const cur = getLongitudeSegmentCountOfIdx(i + 1, segment)
    if (prev !== cur) count += 1
    prev = cur
  }
  return count
}

/**
 * 把包围盒按「每行格数变化」（= 回归线）切成若干 area，每个 area 一个矩形框 + 一个扩半行的框
 * 负纬度档号那里 `i = -i; i--;` 不对称，北半球档的 box 比真实行域高一行、南半球低一行，
 * 粘贴侧靠 ±0.5 的扩展盒加回归线过滤把多出来的那行丢掉
 */
function splitGratBoxInTropicAreas(gratbox, segment) {
  let x = f(gratbox.x)
  const y = f(gratbox.y)
  let z = f(gratbox.z)
  const w = f(gratbox.w)
  if (z < f(x - 1e-5)) z = f(z + DOUBLE_PI)

  const idxNorth = getSnappedLatitudeGridIdx(w, segment)
  const idxSouth = getSnappedLatitudeGridIdx(y, segment)
  const latitudeRadPerGrid = getLatitudeRadPerGrid(segment)

  const areaBoxes = []
  let cur = 0
  let lastLngSet = -1
  let y2 = y
  areaBoxes[cur] = bpGratBox(0, y2, 0, y2)
  let prevSegCnt = getLongitudeSegmentCountOfIdx(idxSouth, segment)

  for (let i = idxSouth; i <= idxNorth; i += 1) {
    const num5 = i + 1 > idxNorth ? idxNorth : i + 1
    y2 = f(num5 * latitudeRadPerGrid)
    const segCnt = prevSegCnt
    prevSegCnt = getLongitudeSegmentCountOfIdx(num5, segment)
    const changed = segCnt !== prevSegCnt
    if (lastLngSet < cur) {
      const per = getLongitudeRadPerGridOfSegCnt(segCnt, segment)
      const lngMin = roundFloat(f(x / per))
      const lngMax = roundFloat(f(z / per))
      let west = f(lngMin * per)
      let east = f(lngMax * per)
      if (east > f(f(f(west + DOUBLE_PI) - 1e-5) - 4e-6)) east = f(f(west + DOUBLE_PI) - per)
      if (west < -PI) west = f(west + DOUBLE_PI)
      if (west > PI) west = f(west - DOUBLE_PI)
      if (east < -PI) east = f(east + DOUBLE_PI)
      if (east > PI) east = f(east - DOUBLE_PI)
      areaBoxes[cur].x = west
      areaBoxes[cur].z = east
      lastLngSet = cur
    }
    if (changed) {
      cur += 1
      areaBoxes[cur] = bpGratBox(0, y2, 0, y2)
    } else {
      areaBoxes[cur].w = y2
    }
  }

  const count = cur + 1
  const areaBoxesEx = []
  for (let j = 0; j < count; j += 1) areaBoxesEx[j] = getExtendedGratBox(areaBoxes[j])
  return { count, areaBoxes, areaBoxesEx }
}

// ─────────────────────────────────────────────────────────────
// 4. 复制侧: 选区包围盒
// ─────────────────────────────────────────────────────────────

/**
 * 定「分割经线」: 挑经度上最空的一条线切开，免得选区横跨经度接缝
 * 把涂过的格子投影到赤道档的 1000 个经度刻度上，找最长的一段空白，取中点作为「分割线」，
 * 蓝图里的经度都以它为参照，这样选区不会跨 ±180°。
 */
function determineDivideLine(segment, mask) {
  const equatorCells = determineLongitudeSegmentCount(0, segment) * 5
  const marks = new Uint8Array(1001)
  const half = Math.trunc(equatorCells / 2)
  const bandHalf = Math.trunc(half / 2)
  for (let j = 0; j < half; j += 1) {
    const cells = determineLongitudeSegmentCount(Math.trunc((j > bandHalf ? bandHalf - j : j) / 5), segment) * 5
    const halfCells = Math.trunc(cells / 2)
    const rowBase = j * equatorCells
    for (let k = rowBase; k <= rowBase + cells - 1; k += 1) {
      if ((mask[k >>> 5] & (1 << (k & 31))) === 0) continue
      const col = k - rowBase
      let mark = mathfRoundToInt(
        f(f(f(col >= halfCells ? halfCells - col : col) + halfCells) * f(f(equatorCells) / f(cells))),
      )
      if (mark >= 1001) mark = mark - 1002
      marks[mark] = 1
    }
  }
  let allMarked = marks[0] !== 0 || marks[1000] !== 0
  if (allMarked) {
    allMarked = true
    for (let i = 1; i < 1000; i += 1) {
      if (!marks[i]) {
        allMarked = false
        break
      }
    }
    if (allMarked) marks.fill(0) // 整圈都标记 → 退回建筑那一份（没有建筑 → 全 0）
  }
  let first = -1
  let last = -1
  let prev = -1
  let gapStart = -1
  let gapLen = 0
  for (let i = 0; i < 1001; i += 1) {
    if (!marks[i]) continue
    if (prev === -1) {
      prev = i
      first = i
      last = i
      continue
    }
    const len = i - prev
    if (len > gapLen) {
      gapStart = prev
      gapLen = len
    }
    prev = i
    last = i
  }
  const wrapLen = first + 1000 - last
  if (wrapLen > gapLen) {
    const mid = last + Math.trunc(wrapLen / 2)
    return f(mathfRepeat(f(mid * 0.0062831854820251465), DOUBLE_PI) - PI)
  }
  const mid = gapStart + Math.trunc(gapLen / 2)
  return f(f(mid * 0.0062831854820251465) - 3.1415927410125732)
}

/**
 * 包围盒补到最外侧那行的外沿
 * 复制侧盒子上下各内缩一行（靠 ±0.5 行扩展捞回），但最外侧那行若正好从回归线起头，
 * 会被分档过滤整行丢掉 → 这时补一行
 */
function coverTropicEdgeRows(box, segment) {
  const latitudeRadPerGrid = getLatitudeRadPerGrid(segment)
  // 数据行按「行号 / 5」分档，area 段数按「边界行号 - 1」分档 → 回归线上差一档
  const rowSegCnt = (rad) =>
    determineLongitudeSegmentCount(Math.trunc(f(f(rad) / latitudeRadPerGrid) / 5), segment)
  const edgeSegCnt = (rad) => getLongitudeSegmentCountOfIdx(getSnappedLatitudeGridIdx(rad, segment), segment)
  const y = rowSegCnt(box.y) === edgeSegCnt(box.y) ? box.y : f(box.y - latitudeRadPerGrid)
  const w = rowSegCnt(box.w) === edgeSegCnt(box.w) ? box.w : f(box.w + latitudeRadPerGrid)
  return bpGratBox(box.x, y, box.z, w)
}

/**
 * 涂过的格子 → 选区包围盒（弧度）
 * 建筑分支跳过（地基蓝图没有建筑，且它不影响地基块的结果）。
 */
function getBoundingRange(grid, mask, divideLongitude, segment) {
  const equatorCells = determineLongitudeSegmentCount(0, segment) * 5
  const rows = grid.rows
  let lngMin = Infinity
  let latMin = Infinity
  let lngMax = -Infinity
  let latMax = -Infinity
  let flag = true

  const rowCount = Math.trunc(equatorCells / 2)
  const bandHalf = Math.trunc(rowCount / 2)
  let divFrac = f(f(divideLongitude) / DOUBLE_PI)
  divFrac = divFrac < 0 ? f(0.5 - divFrac) : divFrac
  const baseCellW = f(DOUBLE_PI / equatorCells)

  const latHiOf = (j) => f((j >= bandHalf ? bandHalf - j : j + 1) * baseCellW)
  const pushLngMin = (v) => {
    let x = f(v)
    if (x <= NEG_LNG_EPS) x = f(x + DOUBLE_PI)
    if (lngMin > x) lngMin = x
  }
  const pushLngMax = (v) => {
    let x = f(v)
    if (x <= NEG_LNG_EPS) x = f(x + DOUBLE_PI)
    if (lngMax < x) lngMax = x
  }
  const pushLat = (j) => {
    const hi = latHiOf(j)
    latMax = Math.max(latMax, f(hi - baseCellW))
    latMin = Math.min(latMin, hi)
  }
  const bitAt = (i) => (mask[i >>> 5] & (1 << (i & 31))) !== 0
  const wordZero = (i) => mask[i >>> 5] === 0

  for (let j = 0; j < rowCount; j += 1) {
    const cells = determineLongitudeSegmentCount(Math.trunc((j >= bandHalf ? bandHalf - j : j) / 5), segment) * 5
    const halfCells = Math.trunc(cells / 2)
    const cellW = f(DOUBLE_PI / cells)
    let startCol = Math.trunc(f(divFrac * cells))
    if (startCol >= cells) startCol = cells - 1
    if (bitAt(j * equatorCells + startCol)) {
      pushLat(j)
      lngMin = 0
      lngMax = DOUBLE_PI
    }
    let found = false
    if (startCol >= halfCells) {
      for (let c = startCol - 1; c >= halfCells; c -= 1) {
        const bit = j * equatorCells + c
        if (wordZero(bit)) {
          c = (bit & ~31) - j * equatorCells
        } else if (bitAt(bit)) {
          found = true
          pushLat(j)
          pushLngMin(f(f((halfCells - c - 1) * cellW) - divideLongitude))
          break
        }
      }
      if (!found) {
        for (let k = 0; k < halfCells; k += 1) {
          const bit = j * equatorCells + k
          if (wordZero(bit)) {
            k = (bit | 0x1f) - j * equatorCells
          } else if (bitAt(bit)) {
            found = true
            pushLat(j)
            pushLngMin(f(f(k * cellW) - divideLongitude))
            break
          }
        }
      }
      if (!found) {
        for (let c = cells - 1; c > startCol; c -= 1) {
          const bit = j * equatorCells + c
          if (wordZero(bit)) {
            c = (bit & ~31) - j * equatorCells
          } else if (bitAt(bit)) {
            found = true
            pushLat(j)
            pushLngMin(f(f((halfCells - c - 1) * cellW) - divideLongitude))
            break
          }
        }
      }
      if (!found) continue
      flag = false
      found = false
      for (let l = startCol + 1; l < cells; l += 1) {
        const bit = j * equatorCells + l
        if (wordZero(bit)) {
          l = (bit | 0x1f) - j * equatorCells
        } else if (bitAt(bit)) {
          found = true
          pushLngMax(f(f((halfCells - l) * cellW) - divideLongitude))
          break
        }
      }
      if (!found) {
        for (let c = halfCells - 1; c >= 0; c -= 1) {
          const bit = j * equatorCells + c
          if (wordZero(bit)) {
            c = (bit & ~31) - j * equatorCells
          } else if (bitAt(bit)) {
            pushLngMax(f(f((c + 1) * cellW) - divideLongitude))
            break
          }
        }
      }
      if (found) continue
      for (let m = halfCells; m < startCol; m += 1) {
        const bit = j * equatorCells + m
        if (wordZero(bit)) {
          m = (bit | 0x1f) - j * equatorCells
        } else if (bitAt(bit)) {
          pushLngMax(f(f((halfCells - m) * cellW) - divideLongitude))
          break
        }
      }
      continue
    }
    // startCol < halfCells
    for (let n = startCol + 1; n < halfCells; n += 1) {
      const bit = j * equatorCells + n
      if (wordZero(bit)) {
        n = (bit | 0x1f) - j * equatorCells
      } else if (bitAt(bit)) {
        found = true
        pushLat(j)
        pushLngMin(f(f(n * cellW) - divideLongitude))
        break
      }
    }
    if (!found) {
      for (let c = cells - 1; c >= halfCells; c -= 1) {
        const bit = j * equatorCells + c
        if (wordZero(bit)) {
          c = (bit & ~31) - j * equatorCells
        } else if (bitAt(bit)) {
          found = true
          pushLat(j)
          pushLngMin(f(f((halfCells - c - 1) * cellW) - divideLongitude))
          break
        }
      }
    }
    if (!found) {
      for (let c = 0; c < startCol; c += 1) {
        const bit = j * equatorCells + c
        if (wordZero(bit)) {
          c = (bit | 0x1f) - j * equatorCells
        } else if (bitAt(bit)) {
          found = true
          pushLat(j)
          pushLngMin(f(f(c * cellW) - divideLongitude))
          break
        }
      }
    }
    if (!found) continue
    flag = false
    found = false
    for (let c = startCol - 1; c >= 0; c -= 1) {
      const bit = j * equatorCells + c
      if (wordZero(bit)) {
        c = (bit & ~31) - j * equatorCells
      } else if (bitAt(bit)) {
        found = true
        pushLngMax(f(f((c + 1) * cellW) - divideLongitude))
        break
      }
    }
    if (!found) {
      for (let c = halfCells; c < cells; c += 1) {
        const bit = j * equatorCells + c
        if (wordZero(bit)) {
          c = (bit | 0x1f) - j * equatorCells
        } else if (bitAt(bit)) {
          found = true
          pushLngMax(f(f((halfCells - c) * cellW) - divideLongitude))
          break
        }
      }
    }
    if (found) continue
    for (let c = halfCells - 1; c > startCol; c -= 1) {
      const bit = j * equatorCells + c
      if (wordZero(bit)) {
        c = (bit & ~31) - j * equatorCells
      } else if (bitAt(bit)) {
        pushLngMax(f(f((c + 1) * cellW) - divideLongitude))
        break
      }
    }
  }

  if (latMin > latMax) {
    if (latMin < 0) latMin = latMax
    else latMax = latMin
  }
  if (lngMin < 0) lngMin = 0
  else if (lngMin > TROPIC_GRATBOX_LNG_MAX) lngMin = TROPIC_GRATBOX_LNG_MAX
  if (lngMax < 0) lngMax = 0
  else if (lngMax > TROPIC_GRATBOX_LNG_MAX) lngMax = TROPIC_GRATBOX_LNG_MAX
  if (flag) {
    lngMin = 0
    lngMax = TROPIC_GRATBOX_LNG_MAX
  }
  lngMin = f(lngMin + divideLongitude)
  lngMax = f(lngMax + divideLongitude)
  if (lngMin < -PI) lngMin = f(lngMin + DOUBLE_PI)
  else if (lngMin > PI) lngMin = f(lngMin - DOUBLE_PI)
  if (lngMax < -PI) lngMax = f(lngMax + DOUBLE_PI)
  else if (lngMax > PI) lngMax = f(lngMax - DOUBLE_PI)
  void rows
  return bpGratBox(lngMin, latMin, lngMax, latMax)
}

// ─────────────────────────────────────────────────────────────
// 5. 矩形合并 + 经度锚点
// ─────────────────────────────────────────────────────────────

/**
 * 把一块区内的地基数据合并成矩形（同色同宽、上下相邻的并成一条）
 * 逐行扫描，同色横向连成一条，再用 openList 把上下相邻、宽度与颜色都相同的条竖着拼起来。
 *
 * @param {Uint8Array} cells 行优先（南 → 北，区内列 0 → width-1），0 = 没有地基
 */
function generateReformRects(cells, width, height, areaIndex) {
  const rects = []
  const open = new Uint32Array(width)
  const flush = (x, y, cur) => {
    const data = cur & 0xff
    rects.push({
      x,
      y,
      w: (cur >> 8) & 0xff,
      h: (cur >> 16) & 0xff,
      type: data >> 5,
      color: data & 0x1f,
      areaIndex,
    })
  }

  for (let i = 0; i < height; i += 1) {
    const rowBase = i * width
    let j = 0
    while (j < width) {
      const b = cells[rowBase + j]
      if (b >> 5 === 0) {
        if (open[j] !== 0) {
          flush(j, i - ((open[j] >> 16) & 0xff), open[j])
          open[j] = 0
        }
        j += 1
        continue
      }
      const start = j
      j += 1
      const limit = Math.min(j + 254, width)
      while (j < limit && cells[rowBase + j] === b) {
        if (open[j] !== 0) {
          flush(j, i - ((open[j] >> 16) & 0xff), open[j])
          open[j] = 0
        }
        j += 1
      }
      const packed = ((j - start) << 8) | b
      const cur = open[start]
      if (cur === 0) {
        open[start] = 0x10000 | packed
      } else if ((cur & 0xffff) === packed) {
        if (((cur >> 16) & 0xff) < 254) open[start] = cur + 65536
        else {
          flush(start, i - 255, (cur & 0xffff) | (255 << 16))
          open[start] = 0x10000 | packed
        }
      } else {
        flush(start, i - ((cur >> 16) & 0xff), cur)
        open[start] = 0x10000 | packed
      }
    }
  }

  for (let k = 0; k < width; k += 1) {
    if (open[k] !== 0) flush(k, height - ((open[k] >> 16) & 0xff), open[k])
  }
  return rects
}

/**
 * 找出让本 area 西边界与父 area 西边界的格子交点重合的一对小整数偏移
 * 返回 { x: anchorLocalOffsetX, y: tropicAnchor }
 */
function getTropicAnchorOffset(localStartPos, parentStartPos, localStartLngRad, segment) {
  const per = getLongitudeRadPerGridOfDir(localStartPos, segment)
  let snappedParentLng = getSnappedLongitudeRadOfDir(parentStartPos, segment)
  const per2 = getLongitudeRadPerGridOfDir(parentStartPos, segment)
  const localStart = f(mathfRepeat(f(f(localStartLngRad) + PI), DOUBLE_PI) - PI)
  snappedParentLng = f(mathfRepeat(f(snappedParentLng + PI), DOUBLE_PI) - PI)
  let num = 0
  let num2 = 0
  let guard = 0
  while (guard++ < 15) {
    const a = f(localStart + f(num * per))
    const b = f(snappedParentLng + f(num2 * per2))
    const d = f(Math.abs(f(b - a)))
    const d2 = f(Math.abs(f(DOUBLE_PI - d)))
    if (d < TROPIC_OFFSET_RAD_EPSILON || d2 < TROPIC_OFFSET_RAD_EPSILON) break
    const flip = d2 < d
    if (flip !== b > a) num += 1
    else num2 += 1
  }
  return { x: num, y: num2 }
}

// ─────────────────────────────────────────────────────────────
// 6. 导出
// ─────────────────────────────────────────────────────────────

/**
 * 把地基彩绘编成工厂蓝图对象（再交给 factoryEncoder.stringifyBlueprint 编成字符串）
 *
 * @param {object} grid createPlanetGrid() 的返回值
 * @param {Array<{r:number,g:number,b:number}>} palette 调色板（最多 16 色）
 * @param {Uint8Array} index 每格色号（255 = 不铺）
 * @param {{shortDesc?:string, desc?:string, reformType?:number, layout?:number, icons?:number[]}} [opts]
 * @returns {object} 与 factoryParser.parseBlueprintString 输出同构的蓝图对象
 */
export function buildFoundationBlueprint(grid, palette, index, opts = {}) {
  if (!grid?.rows?.length || !index) throw new Error('地基网格数据无效')
  if (!palette?.length) throw new Error('调色板是空的')
  const reformType = opts.reformType ?? DEFAULT_REFORM_TYPE
  if (!Number.isInteger(reformType) || reformType < 1 || reformType > 6) {
    throw new Error(`地基装饰类型 ${reformType} 无效（只能是 1-6）`)
  }

  const segment = grid.segment ?? 200
  const equatorCells = determineLongitudeSegmentCount(0, segment) * 5
  const latitudeRadPerGrid = getLatitudeRadPerGrid(segment)

  // ── 涂色数据 → reformData 字节 + 位图（下标 = 行号 * 赤道格数 + 经度格号）──
  const reformData = new Uint8Array(grid.total)
  const mask = new Uint32Array(Math.ceil((grid.latitudeCount * equatorCells) / 32))
  let paintedCount = 0
  let colorMask = 0
  for (const row of grid.rows) {
    for (let m = 0; m < row.cells; m += 1) {
      const ci = index[row.base + m]
      if (ci === FOUNDATION_NO_COLOR) continue
      const slot = CUSTOM_COLOR_BASE + ci
      if (slot >= MAX_COLOR_SLOTS) throw new Error(`色号 ${ci} 超出可编码范围`)
      const b = (reformType << 5) | slot
      reformData[row.base + m] = b
      const bit = row.row * equatorCells + m
      mask[bit >>> 5] = (mask[bit >>> 5] | (1 << (bit & 31))) >>> 0
      colorMask = (colorMask | (1 << slot)) >>> 0
      paintedCount += 1
    }
  }
  if (paintedCount === 0) throw new Error('还没有可导出的地基彩绘')

  // ── 选区包围盒 → 热带分区 ──
  const divideLongitude = determineDivideLine(segment, mask)
  const boundingRange = coverTropicEdgeRows(getBoundingRange(grid, mask, divideLongitude, segment), segment)
  const areaCount = getAreaCount(boundingRange.y, boundingRange.w, segment)
  const { count, areaBoxes, areaBoxesEx } = splitGratBoxInTropicAreas(boundingRange, segment)
  if (count !== areaCount) {
    throw new Error(`area 数量不一致: 按纬度算出来 ${areaCount} 个，切开得到 ${count} 个`)
  }

  const num6 = Math.trunc(equatorCells / 4)
  const rects = []
  const areas = new Array(areaCount)
  let primaryIdx = 0
  let maxSegments = 0

  for (let j = 0; j < areaCount; j += 1) {
    const box = areaBoxes[j]
    const boxEx = areaBoxesEx[j]
    const segments = getLongitudeSegmentCountOfDir(getDir(box.x, box.y), segment)
    const lngPerGrid = getLongitudeRadPerGridOfSegCnt(segments, segment)
    const num7 = segments * 5
    const num8 = Math.trunc(num7 / 2)
    if (segments > maxSegments) {
      maxSegments = segments
      primaryIdx = j
    }
    // ── 逐行填充 area 的格子阵 ──
    const num16 = f(boxEx.y / latitudeRadPerGrid)
    const num17 = f(boxEx.w / latitudeRadPerGrid)
    const num18 = round2int(f(box.x / lngPerGrid))
    const num19 = round2int(f(f(num17 - num16) + 1))
    const data = new Uint8Array(num7 * num19)
    for (let l = 0; l < num19; l += 1) {
      const num20 = f(num16 + l)
      if (determineLongitudeSegmentCount(Math.trunc(f(num20 / 5)), segment) !== segments) continue
      const num21 = Math.trunc(num20 >= 0 ? num20 : f(num6 - num20))
      const row = grid.rows[num21]
      if (!row) continue
      for (let m = 0; m < num7; m += 1) {
        const b = reformData[row.base + m]
        if (b === 0) continue
        const num23 = m >= num8 ? num8 - m - 1 : m
        const num24 = num23 - num18 + (num23 < num18 ? num7 : 0)
        data[l * num7 + num24] = (b & 0xe0) === UNDECAL_REFORM_TYPE << 5 ? 224 : b
      }
    }
    // 逐条推进（矩形可能有几万条，不能用展开运算符）
    for (const rect of generateReformRects(data, num7, num19, j)) rects.push(rect)
  }

  // ── area 元数据（南边界 / 尺寸 / 锚点）──
  const buildArea = (i, parentIndex) => {
    const dir = getDir(areaBoxes[i].x, areaBoxes[i].y)
    const parentDir = getDir(areaBoxes[parentIndex].x, areaBoxes[parentIndex].y)
    const segments = getLongitudeSegmentCountOfDir(dir, segment)
    const lngPerGrid = getLongitudeRadPerGridOfSegCnt(segments, segment)
    const anchor = getTropicAnchorOffset(dir, parentDir, areaBoxes[i].x, segment)
    return {
      index: i,
      parentIndex,
      tropicAnchor: anchor.y,
      areaSegments: segments,
      anchorLocalOffset: {
        x: anchor.x,
        y: round2int(f(f(areaBoxes[i].y - getLatitudeRadOfDir(parentDir)) / latitudeRadPerGrid)),
      },
      size: {
        x: Math.trunc(f(f(bpWidth(areaBoxes[i]) / lngPerGrid) + 1.5)),
        y: Math.trunc(f(f(bpHeight(areaBoxes[i]) / latitudeRadPerGrid) + 1.5)),
      },
    }
  }
  for (let i = primaryIdx - 1; i >= 0; i -= 1) areas[i] = buildArea(i, i + 1)
  for (let i = primaryIdx + 1; i < areaCount; i += 1) areas[i] = buildArea(i, i - 1)
  areas[primaryIdx] = {
    index: primaryIdx,
    parentIndex: -1,
    tropicAnchor: 0,
    areaSegments: getLongitudeSegmentCountOfDir(getDir(areaBoxes[primaryIdx].x, areaBoxes[primaryIdx].y), segment),
    anchorLocalOffset: { x: 0, y: 0 },
    size: {
      x: Math.trunc(f(f(bpWidth(areaBoxes[primaryIdx]) / getLongitudeRadPerGridOfSegCnt(getLongitudeSegmentCountOfDir(getDir(areaBoxes[primaryIdx].x, areaBoxes[primaryIdx].y), segment), segment)) + 1.5)),
      y: Math.trunc(f(f(bpHeight(areaBoxes[primaryIdx]) / latitudeRadPerGrid) + 1.5)),
    },
  }

  // ── 自定义调色板: 16 个槽位，色号 16+i 指向第 i 个 ──
  const customReformColors = []
  for (let i = 0; i < 16; i += 1) {
    const c = palette[i]
    customReformColors.push(c
      ? ((((c.r & 0xff) << 24) | ((c.g & 0xff) << 16) | ((c.b & 0xff) << 8) | 0xff) >>> 0)
      : 0)
  }

  // ── 粘贴预览框 ──
  let dragBoxSizeY = 0
  for (const area of areas) dragBoxSizeY += area.size.y
  const cursorOffset = areaCount === 1
    ? {
      x: round2int(f(f(areas[primaryIdx].size.x * 0.5) - 0.01)),
      y: round2int(f(f(areas[primaryIdx].size.y * 0.5) - 0.01)),
    }
    : {
      x: round2int(f(f(areas[primaryIdx].size.x * 0.5) - 0.01)),
      y: round2int(f(
        f(f(f(f(f(boundingRange.w - boundingRange.y) * 0.5) + boundingRange.y) - areaBoxes[primaryIdx].y) / latitudeRadPerGrid),
      )),
    }

  return {
    header: {
      layout: opts.layout ?? DEFAULT_LAYOUT,
      icons: opts.icons ?? [...DEFAULT_ICONS],
      shortDesc: opts.shortDesc ?? '地基彩绘',
      desc: opts.desc
    },
    version: 2,
    cursorOffset,
    cursorTargetArea: primaryIdx,
    dragBoxSize: { x: areas[primaryIdx].size.x, y: dragBoxSizeY },
    primaryAreaIdx: primaryIdx,
    areas,
    buildings: [],
    patch: 0,
    reformData: {
      rects,
      customReformColorMask: (colorMask & 0xffff0000) >>> 0,
      customReformColors,
    },
    stats: {
      paintedCount,
      areaCount,
      rectCount: rects.length,
      divideLongitudeDeg: (divideLongitude * 180) / Math.PI,
      // 每个 area 的格子框（自测/调试用）
      boxes: areas.map((area, i) => ({
        south: areaBoxes[i].y,
        westLngDeg: (areaBoxes[i].x * 180) / Math.PI,
        eastLngDeg: (areaBoxes[i].z * 180) / Math.PI,
        northLatDeg: (areaBoxes[i].w * 180) / Math.PI,
        sizeX: area.size.x,
        sizeY: area.size.y,
        segCnt: area.areaSegments,
      })),
    },
  }
}

void mathSign
