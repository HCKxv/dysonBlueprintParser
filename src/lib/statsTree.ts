/**
 * statsTree — 左侧蓝图信息面板的数据树构建
 *
 * 节点类型:
 *   { kind:'stat',    label, value }
 *   { kind:'toggle',  layerType, id, label, value, checked }
 *   { kind:'section', title, count, children: StatNode[] }
 */
import { quaternionToOrbitParams, gridTypeName, countPaintedCells } from './blueprint/utils.js'

export interface StatNode {
  kind: 'stat' | 'toggle' | 'section'
  label?: string
  value?: string
  layerType?: 'shell' | 'cloud'
  id?: number
  checked?: boolean
  title?: string
  count?: number
  children?: StatNode[]
}

/** 轨道 */
interface OrbitLike {
  id: number
  radius: number
  x: number
  y: number
  z: number
  w: number
}

function countComponents(list: unknown[] | null | undefined): number {
  return list ? list.filter(Boolean).length : 0
}

// 轨道参数行（半径/倾角/升交点）
function fmtOrbitLine(orbit: OrbitLike): string {
  const op = quaternionToOrbitParams(orbit)
  return '半径 ' + orbit.radius.toFixed(0) + ' / 倾角 ' + op.inclination.toFixed(1) + '° / 升交点 ' + op.ascendingNode.toFixed(1) + '°'
}

// 可见性行
function fmtVisibilityLine(ed: boolean, gv: boolean): string {
  return '编辑器' + (ed ? '显示' : '不显示') + ' / 游戏内' + (gv ? '显示' : '不显示')
}

// 壳层核心统计内容（单层壳/多层壳共用）
function fmtShellValue(shData: any, layerData: any): string {
  const nodeCnt = countComponents(shData?.nodes)
  const frameCnt = countComponents(shData?.frames)
  const faceCnt = countComponents(shData?.faces)
  const paintCnt = countPaintedCells(shData?.fillGrid?.colors)
  const structPts = (layerData?.totalNodeSP || 0) + (layerData?.totalFrameSP || 0)
  const cellPts = layerData?.totalCP || 0
  const lines = [
    '节点' + nodeCnt + ' / 框架' + frameCnt + ' / 壳面' + faceCnt,
    '结构点数' + structPts + ' / 细胞点数' + cellPts,
    '网格涂色：' + (paintCnt ? gridTypeName(shData.fillGrid.gridType) + ' / ' + paintCnt : '无'),
  ]
  return lines.join('<br>')
}

/**
 * 构建信息面板节点树
 * @param parsed - 解析结果（header + body）
 * @param powerResult - computePoints 的结果，可为 null
 */
export function buildStatsTree(
  parsed: Record<string, any>,
  powerResult: Record<string, any> | null,
): StatNode[] {
  const nodes: StatNode[] = []
  const singleShell = parsed.body.singleShell
  const cloud = parsed.body.dysonCloud
  const shell = parsed.body.dysonShell

  if (parsed?.validFlag === false) {
    nodes.push({
      kind: 'stat', label: '⚠该蓝图校验未通过',
      value: '蓝图被修改过，无法在游戏内粘贴',
    })
  }

  // ── 蓝图信息 ──
  nodes.push({
    kind: 'stat', label: '蓝图信息',
    value: '蓝图类型：' + (parsed.header.typeName || '未知') + '<br>' +
      '游戏版本：' + parsed.header.version + '<br>' +
      '创建时间：' + parsed.header.createdAt + '<br>' +
      '应力系统等级需求：等级 ' + (Math.min(6, Math.max(0, Math.ceil((parsed.header.latLimit || 0) / 15)))),
  })

  // ── 建造总量 ──
  if ([2, 4].includes(parsed.body.typeId)) {
    nodes.push({
      kind: 'stat', label: '建造',
      value: '总结构点数：' + ((powerResult?.totalNodeSP || 0) + (powerResult?.totalFrameSP || 0)) + '<br>' +
        '总细胞点数：' + (powerResult?.totalCP || 0),
    })
  }

  // ── 云轨道 ──
  if (cloud?.orbits) {
    const orbits = cloud.orbits.filter(Boolean).sort((a: any, b: any) => a.id - b.id)
    nodes.push({
      kind: 'section', title: '云轨道', count: orbits.length,
      children: orbits.map((orb: any): StatNode => {
        const ed = cloud.visibility ? cloud.visibility.editor[orb.id] : true
        const gv = cloud.visibility ? cloud.visibility.inGame[orb.id] : true
        return {
          kind: 'toggle', layerType: 'cloud', id: orb.id, label: '云轨道 ' + orb.id,
          value: fmtOrbitLine(orb) + '<br>' + fmtVisibilityLine(ed, gv),
          checked: gv,
        }
      }),
    })
  }

  // ── 壳层 ──
  if (singleShell) {
    nodes.push({
      kind: 'stat', label: '单层壳',
      value: fmtShellValue(singleShell, powerResult?.layers?.[0] ?? null),
    })
  } else if (shell?.orbitList) {
    const orbits = shell.orbitList.filter(Boolean).sort((a: any, b: any) => a.id - b.id)
    const items: StatNode[] = orbits.map((orbit: any): StatNode => {
      const shData = shell.shells?.[orbit.id] ?? null
      const layerData = powerResult?.layers.find((l: any) => l.orbitId === orbit.id)
      const ed = shell.visibility ? shell.visibility.editor[orbit.id] : true
      const gv = shell.visibility ? shell.visibility.inGame[orbit.id] : true
      return {
        kind: 'toggle', layerType: 'shell', id: orbit.id, label: '壳层 ' + orbit.id,
        value: [
          fmtOrbitLine(orbit),
          fmtShellValue(shData, layerData),
          fmtVisibilityLine(ed, gv),
        ].join('<br>'),
        checked: gv,
      }
    })
    nodes.push({ kind: 'section', title: '壳层', count: orbits.length, children: items })
  }

  return nodes
}
