import base60 from './base60.json' with { type: 'json' }
import base92 from './base92.json' with { type: 'json' }
import { stringifyBlueprint } from '../blueprint/sphere/blueprintEncoder.js'

/** 单个基底的结构统计 */
function infoOf(blueprint) {
  const shell = blueprint.body.singleShell
  return {
    nodes: (shell.nodes || []).filter((n) => n != null).length,
    frames: (shell.frames || []).filter((f) => f != null).length,
    faces: (shell.faces || []).filter((f) => f != null).length,
    latLimit: blueprint.header.latLimit,
  }
}

/**
 * 内置基底清单
 * @type {Array<{id:string, label:string, blueprint:object, info:ReturnType<typeof infoOf>}>}
 */
export const BUILTIN_BASES = [
  { id: 'base60', label: '60 节点 32 壳面', blueprint: base60, info: infoOf(base60) },
  { id: 'base92', label: '92 节点 180 壳面', blueprint: base92, info: infoOf(base92) },
]

/**
 * 把「解析出来的蓝图」收成基底需要的形状
 * @param {object} bp parseBlueprintString 的结果
 */
export function makeBaseFromBlueprint(bp) {
  const shell = bp?.body?.singleShell
  if (!shell) throw new Error('不是单层壳蓝图（只支持单层戴森壳）')
  return {
    header: {
      typeId: bp.header.typeId,
      latLimit: bp.header.latLimit,
    },
    body: {
      typeId: bp.body.typeId,
      singleShell: {
        nodes: shell.nodes ?? [],
        frames: shell.frames ?? [],
        faces: shell.faces ?? [],
      },
    },
  }
}

/**
 * 把彩绘数据写进基底，编成蓝图字符串
 * @param {{gridType:number, colors:Array<{r:number,g:number,b:number,a:number}>}} fillGrid
 * @param {object} [base] 基底蓝图
 * @returns {Promise<string>}
 */
export async function buildPaintedBlueprint(fillGrid, base = base60) {
  if (!fillGrid || !Array.isArray(fillGrid.colors)) throw new Error('没有可导出的彩绘数据')
  if (!base?.body?.singleShell) throw new Error('基底蓝图无效')
  const bp = structuredClone(base)
  bp.body.singleShell.fillGrid = { gridType: 0, colors: fillGrid.colors }
  return stringifyBlueprint(bp)
}

export { infoOf };
