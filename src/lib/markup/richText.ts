import { TAG_MAX_LEN, tagInfoOfName } from './itemTags.ts'
import type { TagInfo } from './itemTags.ts'

/**
 * 原始文本层: 标记文法 + 编辑操作
 *
 * 字段里唯一的一份真相是 `text` —— 一段带 `\tag;` 标记的纯文本。这一层只认字符串和字符偏移，
 * 不碰 DOM、不碰 Vue、不认识图标；显示层（richTextDom）负责把它投影成"文字 + 图标 + 换行"。
 * 位置单位是原文里的字符偏移（UTF-16）: 图标占它那段标记的长度（`\tiek;` 算 6 个）。
 */

/* ── 标记文法 ──────────────────────────────────────────
   一个标记就是 `\` + 名字 + `;` 三部分连在一起，**出现在哪儿都算**，不看前后 */

/** 富文本片段：文字 或 图标（图标 id 交给界面去取图） */
export type RichSegment =
  | { type: 'text', text: string }
  | {
    type: 'icon'
    tag: string
    id: number
    name: string
    /** 原文片段（`\tiek;`），重拼回文本时原样写回 */
    raw: string
  }

/** 从 start 处按最长匹配找标记（顺带把表里的 id / 名字带出来，省一次查表） */
function matchTag(text: string, start: number): TagInfo | null {
  const end = Math.min(text.length, start + TAG_MAX_LEN)
  for (let i = end; i > start; i -= 1) {
    const hit = tagInfoOfName(text.slice(start, i))
    if (hit) return hit
  }
  return null
}

/** 把带标记的文本拆成 文字 / 图标 片段；认不出来的一律原样保留为文字（绝不吞字符） */
export function parseRichText(input: string): RichSegment[] {
  const text = input ?? ''
  const segments: RichSegment[] = []
  let buffer = ''
  let i = 0

  const flush = () => {
    if (buffer) {
      segments.push({ type: 'text', text: buffer })
      buffer = ''
    }
  }

  while (i < text.length) {
    if (text[i] !== '\\') {
      buffer += text[i]
      i += 1
      continue
    }

    // 名字后面必须紧跟 `;`，否则整段按普通文字收下、从名字之后继续扫
    const hit = matchTag(text, i + 1)
    if (!hit) {
      buffer += text[i]
      i += 1
      continue
    }
    let next = i + 1 + hit.tag.length
    if (text[next] !== ';') {
      buffer += text.slice(i, next)
      i = next
      continue
    }

    next += 1
    flush()
    segments.push({
      type: 'icon',
      tag: hit.tag,
      id: hit.id,
      name: hit.name,
      raw: text.slice(i, next),
    })
    i = next
  }

  flush()
  return segments
}

/* ── 状态与长度上限 ──────────────────────────────────── */

/** 一次编辑的状态: 原始文本 + 选区（端点是原文偏移，相等时就是光标） */
export interface RichTextState {
  text: string
  /** 选区起点（含） */
  start: number
  /** 选区终点（不含） */
  end: number
}

/** 原文里的一段区间（半开区间 `[start, end)`） */
export interface TextSpan {
  start: number
  end: number
}

/** 删除单位（对应浏览器的按字符 / 按词 / 按行删除） */
export type DeleteUnit = 'char' | 'word' | 'line'

/** 字母 / 数字 / 下划线（按词删除时"一个词"的范围） */
const WORD_CHAR = /[0-9A-Za-z_]/
const SPACE = /\s/

/** 换行统一成 `\n`（蓝图文本、DOM 里的 `<br>` 都只认它） */
export function normalizeText(value: string): string {
  return (value ?? '').replace(/\r\n?/g, '\n')
}

/** 光标左边那个字符占几个码元（代理对算两个，别把 emoji 劈成半个） */
function charWidthBefore(text: string, pos: number): number {
  if (pos <= 0) return 0
  const low = text.charCodeAt(pos - 1)
  if (pos >= 2 && low >= 0xDC00 && low <= 0xDFFF) {
    const high = text.charCodeAt(pos - 2)
    if (high >= 0xD800 && high <= 0xDBFF) return 2
  }
  return 1
}

/** 光标右边那个字符占几个码元 */
function charWidthAfter(text: string, pos: number): number {
  if (pos >= text.length) return 0
  const high = text.charCodeAt(pos)
  if (pos + 1 < text.length && high >= 0xD800 && high <= 0xDBFF) {
    const low = text.charCodeAt(pos + 1)
    if (low >= 0xDC00 && low <= 0xDFFF) return 2
  }
  return 1
}

/** 把选区收进文本范围内（外部换了内容之后用） */
export function clampState(state: RichTextState): RichTextState {
  const length = state.text.length
  const start = Math.max(0, Math.min(state.start, length))
  const end = Math.max(start, Math.min(state.end, length))
  return { text: state.text, start, end }
}

/**
 * 还能再插几个字符（maxLength <= 0 = 不限）
 *
 * 打开时就已超长的字段按"不比现在更长"算: 插不进字，但删字照旧 —— 否则一敲键盘就把老内容截掉了。
 */
function roomFor(state: RichTextState, maxLength = 0): number {
  if (!maxLength || maxLength <= 0) return Infinity
  const cap = Math.max(maxLength, state.text.length)
  return cap - (state.text.length - (state.end - state.start))
}

/** 掐到还能放下的长度，且不切断标记（切一半既画不出图标又破坏原文，整块宁可不放） */
function clipText(value: string, room: number): string {
  if (room === Infinity) return value
  if (room <= 0) return ''
  if (value.length <= room) return value

  let out = ''
  for (const segment of parseRichText(value)) {
    const raw = segment.type === 'text' ? segment.text : segment.raw
    if (out.length + raw.length > room) {
      return segment.type === 'text' ? out + raw.slice(0, room - out.length) : out
    }
    out += raw
  }
  return out
}

/* ── 基本操作 ────────────────────────────────────────── */

/** 选区里的原文（复制 / 剪切用） */
export function selectionText(state: RichTextState): string {
  return state.text.slice(state.start, state.end)
}

/** 用 value 替换掉选区（光标落在插入内容之后） */
function insert(state: RichTextState, value: string): RichTextState {
  if (!value) return state
  const text = state.text.slice(0, state.start) + value + state.text.slice(state.end)
  const caret = state.start + value.length
  return { text, start: caret, end: caret }
}

/** 删掉 `[from, to)`，光标落在 from */
function deleteRange(state: RichTextState, from: number, to: number): RichTextState {
  const length = state.text.length
  const start = Math.max(0, Math.min(from, length))
  const end = Math.max(start, Math.min(to, length))
  if (start === end) return { text: state.text, start, end: start }
  return { text: state.text.slice(0, start) + state.text.slice(end), start, end: start }
}

/* ── 按单位删除 ──────────────────────────────────────── */

/** 光标左边的词首（连续字母数字算一个词；中文/符号一次一个字符，跟系统输入法手感一致） */
function wordStart(text: string, pos: number): number {
  let i = pos
  while (i > 0 && SPACE.test(text[i - 1])) i -= 1
  if (i > 0 && WORD_CHAR.test(text[i - 1])) {
    while (i > 0 && WORD_CHAR.test(text[i - 1])) i -= 1
    return i
  }
  return Math.max(0, i - charWidthBefore(text, i))
}

/** 光标右边的词尾 */
function wordEnd(text: string, pos: number): number {
  let i = pos
  while (i < text.length && SPACE.test(text[i])) i += 1
  if (i < text.length && WORD_CHAR.test(text[i])) {
    while (i < text.length && WORD_CHAR.test(text[i])) i += 1
    return i
  }
  return Math.min(text.length, i + charWidthAfter(text, i))
}

/** 光标所在行的行首（`\n` 之后） */
function lineStart(text: string, pos: number): number {
  const hit = text.lastIndexOf('\n', Math.max(0, pos - 1))
  return hit < 0 ? 0 : hit + 1
}

/** 光标所在行的行尾（含换行符，和"删到底再合并两行"的手感一致） */
function lineEnd(text: string, pos: number): number {
  const hit = text.indexOf('\n', pos)
  return hit < 0 ? text.length : hit + 1
}

/**
 * 落在原子区间**内部**的边界让开到区间端点
 *
 * atoms 是显示层里真画成图标的那些标记: 删除要整块删，不能把 `\tiek;` 拆成半截。
 */
function widen(pos: number, atoms: TextSpan[], side: 'start' | 'end'): number {
  const hit = atoms.find((span) => pos > span.start && pos < span.end)
  return hit ? hit[side] : pos
}

/** 退格（有选区时就是删掉选区） */
export function backspace(state: RichTextState, unit: DeleteUnit = 'char', atoms: TextSpan[] = []): RichTextState {
  // 终点（有选区时是选区终点）先让开到图标端点，否则下面算出来的 [from, caret) 会切在图标中间
  const caret = widen(state.end, atoms, 'end')
  if (caret > state.start) return deleteRange(state, widen(state.start, atoms, 'start'), caret)
  if (caret <= 0) return state

  const from = unit === 'word' ? wordStart(state.text, caret)
    : unit === 'line' ? lineStart(state.text, caret)
      : caret - charWidthBefore(state.text, caret)
  return deleteRange(state, widen(from, atoms, 'start'), caret)
}

/** 向前删除（Delete 键） */
export function deleteForward(state: RichTextState, unit: DeleteUnit = 'char', atoms: TextSpan[] = []): RichTextState {
  const caret = widen(state.start, atoms, 'start')
  if (state.end > caret) return deleteRange(state, caret, widen(state.end, atoms, 'end'))
  if (caret >= state.text.length) return state

  const to = unit === 'word' ? wordEnd(state.text, caret)
    : unit === 'line' ? lineEnd(state.text, caret)
      : caret + charWidthAfter(state.text, caret)
  return deleteRange(state, caret, widen(to, atoms, 'end'))
}

/* ── 插入文本 ────────────────────────────────────────── */

/**
 * 在光标处插入一段文本（有选区就替换掉那一块）
 *
 * 原样插入、不判断标记（画不画成图标是显示层的事）；超出上限的部分按整个标记掐掉。
 */
export function insertText(state: RichTextState, text: string, maxLength = 0): RichTextState {
  const room = roomFor(state, maxLength)
  if (room <= 0) return state

  const clipped = clipText(text ?? '', room)
  return clipped ? insert(state, clipped) : state
}
