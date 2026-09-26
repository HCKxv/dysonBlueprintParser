/**
 * 编辑历史（撤销 / 重做）
 *
 * 只认快照: 每次改动前把整个状态塞进来，撤销就是把它拿回去 —— 字段状态就几百字，
 * 整份拷贝比增量补丁简单，也不会出现"撤销后内容和光标对不上"。
 *
 * - 连续的同类输入合并成一步（保留更早那份，所以撤销回到这一串输入**之前**）
 * - 撤销 / 重做之后不再合并，否则撤回来的内容会和下一次输入粘成一步
 */

/** 改动种类: 只有同一种才可能合并，写错一个名字就等于"永远不合并"，所以用联合类型管住 */
export type EditKind =
  | 'insert'
  | 'insert-text'
  | 'cut'
  | 'adopt'
  | 'delete-char'
  | 'delete-word'
  | 'delete-line'

/** 一步历史: 改之前的状态 + 这次改动是什么（同类才合并） */
interface Entry<T> {
  state: T
  kind: EditKind
  at: number
}

export interface EditHistory<T> {
  /**
   * 记一步（在改动**之前**调用）
   *
   * @param before   改之前的状态
   * @param kind     改动种类，只有同一种才可能合并
   * @param coalesce 这次改动能否和上一步合并（连续单字符的输入 / 删除传 true）
   */
  record(before: T, kind: EditKind, coalesce?: boolean): void
  /** 撤销: 交出应该恢复的状态（没得撤返回 null） */
  undo(current: T): T | null
  /** 重做 */
  redo(current: T): T | null
  /** 清空（外部换了内容时: 旧快照指向的是另一份文本，不能再撤回去） */
  clear(): void
}

export interface EditHistoryOptions {
  /** 最多记几步（超出就丢最老的） */
  limit?: number
  /** 间隔多久之内的同类改动算一步 */
  coalesceMs?: number
}

export function createEditHistory<T>(options: EditHistoryOptions = {}): EditHistory<T> {
  const limit = options.limit ?? 200
  const coalesceMs = options.coalesceMs ?? 600

  const past: Entry<T>[] = []
  const future: Entry<T>[] = []
  /** 上一步改动: 用来判断能不能和这次合并 */
  let lastKind: EditKind | '' = ''
  let lastAt = 0

  return {
    record(before, kind, coalesce = false) {
      const now = Date.now()
      const merge = coalesce && lastKind === kind && now - lastAt <= coalesceMs && past.length > 0
      if (!merge) {
        past.push({ state: before, kind, at: now })
        if (past.length > limit) past.shift()
      }
      lastKind = kind
      lastAt = now
      // 记了新的一步，原来的"重做"就作废了
      future.length = 0
    },

    undo(current) {
      const entry = past.pop()
      if (!entry) return null
      future.push({ state: current, kind: entry.kind, at: Date.now() })
      lastKind = ''
      return entry.state
    },

    redo(current) {
      const entry = future.pop()
      if (!entry) return null
      past.push({ state: current, kind: entry.kind, at: Date.now() })
      lastKind = ''
      return entry.state
    },

    clear() {
      past.length = 0
      future.length = 0
      lastKind = ''
      lastAt = 0
    },
  }
}
