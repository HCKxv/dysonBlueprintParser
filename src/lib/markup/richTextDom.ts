import { parseRichText } from './richText.ts'
import type { DeleteUnit, TextSpan } from './richText.ts'

/**
 * 显示层: 原始文本 → DOM 的单向投影
 *
 * `projectRichText`（文本 → 节点表）+ `mountRichText`（落到 DOM，能就地更新就就地更新）就是"显示"的全部；
 * `serializeRichText`（DOM → 文本）只用于兜底（自动填充、拼写修正这类浏览器自己动了 DOM 的情况）；
 * `editIntentOf` 把浏览器的输入事件翻成编辑意图 —— 模块里只有这一层说浏览器词汇。
 */

export interface RichRenderOptions {
  /** 图标 id → URL（返回空串时该标记退化成原文） */
  resolveIcon: (itemId: number) => string
}

/**
 * 投影出来的一个节点
 *
 * `start` / `end` 是它在原文里占的区间（图标占整个 `\tiek;`，`<br>` 占一个换行），
 * 编辑层要的原子区间就直接取自 `kind === 'icon'` 的那些节点。
 */
export type RichNode =
  | { kind: 'text', text: string, start: number, end: number }
  | { kind: 'break', start: number, end: number }
  | {
    kind: 'icon'
    tag: string
    id: number
    name: string
    /** 原文片段（`\tiek;`），挂到 img 的 data-markup 上 */
    raw: string
    /** 图标 URL */
    icon: string
    start: number
    end: number
  }

/* ── 投影 ────────────────────────────────────────────── */

/** 原始文本 → 节点表（纯函数）: 认不出的标记、没有图标的标记都原样当文字，投影永远不吞字符 */
export function projectRichText(text: string, options: RichRenderOptions): RichNode[] {
  const nodes: RichNode[] = []
  let at = 0

  for (const segment of parseRichText(text)) {
    if (segment.type === 'icon') {
      const raw = segment.raw
      const icon = options.resolveIcon(segment.id)
      nodes.push(icon
        ? {
          kind: 'icon',
          tag: segment.tag,
          id: segment.id,
          name: segment.name,
          raw,
          icon,
          start: at,
          end: at + raw.length,
        }
        : { kind: 'text', text: raw, start: at, end: at + raw.length })
      at += raw.length
      continue
    }

    // 文本片段里的换行拆成 <br>（见文件头的约定）
    const lines = segment.text.split('\n')
    for (let i = 0; i < lines.length; i += 1) {
      if (i > 0) {
        nodes.push({ kind: 'break', start: at, end: at + 1 })
        at += 1
      }
      if (lines[i]) {
        nodes.push({ kind: 'text', text: lines[i], start: at, end: at + lines[i].length })
        at += lines[i].length
      }
    }
  }
  return nodes
}

/** 节点表 → DOM；能就地更新就就地更新（免得每敲一个字都重建图标节点） */
export function mountRichText(el: HTMLElement, nodes: RichNode[]): void {
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i]
    const current = el.childNodes[i]
    if (current && sameShape(current, node)) {
      updateNode(current, node)
      continue
    }
    const created = createNode(el.ownerDocument, node)
    if (current) el.replaceChild(created, current)
    else el.appendChild(created)
  }
  // 内容变短了: 多出来的节点删掉
  while (el.childNodes.length > nodes.length) el.removeChild(el.lastChild as ChildNode)
}

function sameShape(dom: Node, node: RichNode): boolean {
  if (node.kind === 'text') return dom.nodeType === Node.TEXT_NODE
  if (dom.nodeType !== Node.ELEMENT_NODE) return false
  const tag = (dom as HTMLElement).tagName
  return node.kind === 'break' ? tag === 'BR' : tag === 'IMG'
}

function createNode(doc: Document, node: RichNode): Node {
  if (node.kind === 'text') return doc.createTextNode(node.text)
  if (node.kind === 'break') return doc.createElement('br')

  const img = doc.createElement('img')
  img.className = 'rich-icon'
  // 原子节点: 光标停在它前后、退格整块删。别加 contenteditable="false" ——
  // 那会被当成"不可编辑屏障"，连续图标之间方向键要按两下才跨得过去
  img.draggable = false
  updateNode(img, node)
  return img
}

function updateNode(dom: Node, node: RichNode): void {
  if (node.kind === 'text') {
    if (dom.nodeValue !== node.text) dom.nodeValue = node.text
    return
  }
  if (node.kind === 'break') return

  const img = dom as HTMLImageElement
  // 比属性而不是比 DOM 属性: src 读出来是绝对地址，和投影里的相对地址对不上
  if (img.getAttribute('src') !== node.icon) img.setAttribute('src', node.icon)
  if (img.dataset.markup !== node.raw) img.dataset.markup = node.raw
  if (img.alt !== node.name || img.title !== node.name) {
    img.alt = node.name
    img.title = node.name
  }
}

/* ── 反投影（兜底用） ────────────────────────────────── */

/** DOM → 原始文本（规则与 projectRichText 对称） */
export function serializeRichText(el: HTMLElement | null): string {
  if (!el) return ''
  const out: string[] = []
  appendText(el, out)
  return out.join('')
}

function appendText(parent: Node, out: string[]): void {
  for (const child of Array.from(parent.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      // 连续空格会被浏览器写成 &nbsp;，还原成普通空格
      out.push((child.nodeValue ?? '').replace(/\u00A0/g, ' '))
      continue
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue

    const el = child as HTMLElement
    if (el.tagName === 'BR') {
      out.push('\n')
      continue
    }
    if (el.tagName === 'IMG') {
      out.push(el.dataset.markup ?? '')
      continue
    }
    // 认不出的元素按内容读（投影只会产生上面三种节点，这一支是防御）
    appendText(el, out)
  }
}

/** 一个节点在原文里占几个字符（图标算标记长度，`<br>` 算一个换行）；口径同 serializeRichText */
function textLengthOf(node: Node | null): number {
  if (!node) return 0
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.nodeValue ?? '').replace(/\u00A0/g, ' ').length
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return 0

  const el = node as HTMLElement
  if (el.tagName === 'IMG') return (el.dataset.markup ?? '').length
  if (el.tagName === 'BR') return 1

  const out: string[] = []
  appendText(el, out)
  return out.join('').length
}

/* ── 字符偏移 ↔ DOM 位置 ─────────────────────────────── */

/** 某个子节点之前的字符数 */
function lengthBeforeChild(parent: Node, index: number): number {
  let at = 0
  const children = parent.childNodes
  for (let i = 0; i < index && i < children.length; i += 1) at += textLengthOf(children[i])
  return at
}

/** 目标节点之前的字符数（找不到返回 null；嵌在更深的元素里就递归下去） */
function prefixLength(parent: Node, target: Node): number | null {
  const children = Array.from(parent.childNodes) as Node[]
  const index = children.indexOf(target)
  if (index >= 0) return lengthBeforeChild(parent, index)

  for (let i = 0; i < children.length; i += 1) {
    const child = children[i]
    if (child.nodeType !== Node.ELEMENT_NODE) continue
    const tag = (child as HTMLElement).tagName
    if (tag === 'BR' || tag === 'IMG') continue
    const inner = prefixLength(child, target)
    if (inner !== null) return lengthBeforeChild(parent, i) + inner
  }
  return null
}

/** 容器里的一个 DOM 落点（container, offset）→ 原文偏移 */
function offsetAtPoint(el: HTMLElement, container: Node, offset: number): number | null {
  // 落点就在容器上: Chromium 把"紧挨着某个子节点"表示成 (容器, 子节点下标)，
  // 所以下标 k 的含义是"第 k 个子节点之前"，不是"跨过了它"
  if (container === el) return lengthBeforeChild(el, offset)

  const base = prefixLength(el, container)
  if (base === null) return null

  if (container.nodeType === Node.TEXT_NODE) {
    return base + Math.max(0, Math.min(offset, textLengthOf(container)))
  }
  // 元素（图标 / `<br>`）内部没有字符位: 偏移 0 贴前面，其余贴后面
  return base + (offset <= 0 ? 0 : textLengthOf(container))
}

/** 节点在原文里的区间（图标给的是整个标记的区间） */
export function spanOfNode(el: HTMLElement, node: Node): TextSpan | null {
  const start = prefixLength(el, node)
  return start === null ? null : { start, end: start + textLengthOf(node) }
}

/** 贴在这个子节点前面的落点（优先用文本节点表示，边界最可靠） */
function boundaryBefore(el: HTMLElement, children: Node[], index: number): { container: Node, offset: number } {
  const child = children[index]
  if (child && child.nodeType === Node.TEXT_NODE) return { container: child, offset: 0 }
  const previous = children[index - 1]
  if (previous && previous.nodeType === Node.TEXT_NODE) {
    return { container: previous, offset: (previous.nodeValue ?? '').length }
  }
  return { container: el, offset: Math.max(0, index) }
}

/** 贴在这个子节点后面的落点 */
function boundaryAfter(el: HTMLElement, children: Node[], index: number): { container: Node, offset: number } {
  const next = children[index + 1]
  if (next && next.nodeType === Node.TEXT_NODE) return { container: next, offset: 0 }
  return { container: el, offset: index + 1 }
}

/**
 * 原文第 pos 个字符 → DOM 落点
 *
 * 落在图标 / `<br>` 上时就近吸附（前半贴前面、后半贴后面）: 都往后贴的话光标会被一路推到图标之后。
 */
function pointAtOffset(el: HTMLElement, pos: number, preferBefore: boolean): { container: Node, offset: number } {
  const children = Array.from(el.childNodes)
  let at = 0

  for (let i = 0; i < children.length; i += 1) {
    const child = children[i]
    const size = textLengthOf(child)
    if (pos <= at + size) {
      if (child.nodeType === Node.TEXT_NODE) {
        return pos <= at ? boundaryBefore(el, children, i) : { container: child, offset: pos - at }
      }
      const tag = (child as HTMLElement).tagName
      if (tag !== 'BR' && tag !== 'IMG') {
        // 认不出的元素（不该出现）: 递归进去找落点
        return pointAtOffset(child as HTMLElement, pos - at, preferBefore)
      }
      const into = pos - at
      const snapBefore = into <= 0 ? preferBefore : into * 2 < size
      return snapBefore ? boundaryBefore(el, children, i) : boundaryAfter(el, children, i)
    }
    at += size
  }
  return { container: el, offset: children.length }
}

/** 把光标 / 选区放进容器（只改选区，不聚焦、不动 DOM） */
export function writeSelection(el: HTMLElement, start: number, end: number = start): void {
  const selection = window.getSelection()
  if (!selection) return

  const range = el.ownerDocument.createRange()
  const from = pointAtOffset(el, Math.max(0, start), true)
  const to = start === end ? from : pointAtOffset(el, Math.max(end, start), false)
  try {
    range.setStart(from.container, from.offset)
    range.setEnd(to.container, to.offset)
  } catch {
    // 端点算不出来（DOM 被外部改乱了）: 退化成"贴到末尾"
    range.selectNodeContents(el)
    range.collapse(false)
  }
  selection.removeAllRanges()
  selection.addRange(range)
}

/**
 * 把光标挪进可见范围
 *
 * contenteditable 自己不会滚（单行字段超宽时，光标就跑到框外面看不见了）:
 * overflow: hidden 的元素照样能滚，只调 scrollLeft，不出现滚动条 —— 跟普通输入框一样。
 */
export function revealCaret(el: HTMLElement, padding = 2): void {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return

  const range = selection.getRangeAt(0)
  if (!el.contains(range.startContainer)) return

  // 折叠光标量不到就这一轮不动（个别浏览器给空矩形）
  const caret = range.getBoundingClientRect()
  if (!caret.width && !caret.height) return

  const box = el.getBoundingClientRect()
  const left = box.left + padding
  const right = box.right - padding
  if (caret.left < left) el.scrollLeft -= left - caret.left
  else if (caret.right > right) el.scrollLeft += caret.right - right
}

/** 读当前选区（不在容器里 / 读不出来给 null，调用方保留上次记下的位置） */
export function readSelection(el: HTMLElement): TextSpan | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return null

  const range = selection.getRangeAt(0)
  if (!el.contains(range.startContainer)) return null

  const start = offsetAtPoint(el, range.startContainer, range.startOffset)
  if (start === null) return null

  const end = el.contains(range.endContainer)
    ? offsetAtPoint(el, range.endContainer, range.endOffset)
    : null
  const to = end ?? textLengthOf(el)
  return to >= start ? { start, end: to } : { start: to, end: start }
}

/** 屏幕坐标 → 原文偏移（拖放时按落点定光标用） */
export function offsetFromPoint(el: HTMLElement, x: number, y: number): number | null {
  const doc = el.ownerDocument as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node, offset: number } | null
  }

  if (typeof doc.caretRangeFromPoint === 'function') {
    const range = doc.caretRangeFromPoint(x, y)
    if (!range || !el.contains(range.startContainer)) return null
    return offsetAtPoint(el, range.startContainer, range.startOffset)
  }
  if (typeof doc.caretPositionFromPoint === 'function') {
    const point = doc.caretPositionFromPoint(x, y)
    if (!point || !el.contains(point.offsetNode)) return null
    return offsetAtPoint(el, point.offsetNode, point.offset)
  }
  return null
}

/* ── 浏览器输入 → 编辑意图 ───────────────────────────── */

/**
 * 浏览器的 `inputType` → 该做的那一次编辑
 *
 * 认得的给出具体意图（调用方一律 `preventDefault`，不让浏览器也改一遍 DOM）；`ignore` = 认得但不做事
 * （格式命令之类）；`pass` = 认不出，留给 onInput 兜底读 DOM。
 * `pasted` 只有粘贴 / 拖放用得上 —— 那两种情况浏览器给的 `data` 是空的。
 */
export type EditIntent =
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'delete', unit: DeleteUnit, forward: boolean }
  | { type: 'insert', text: string, coalesce: boolean }
  | { type: 'newline' }
  | { type: 'ignore' }
  | { type: 'pass' }

/** 浏览器的按字符 / 按词 / 按行删除 */
function deleteUnitOf(inputType: string): DeleteUnit {
  if (inputType.includes('Word')) return 'word'
  if (inputType.includes('Line')) return 'line'
  return 'char'
}

export function editIntentOf(inputType: string, data: string, pasted: string): EditIntent {
  if (inputType === 'historyUndo') return { type: 'undo' }
  if (inputType === 'historyRedo') return { type: 'redo' }
  if (inputType.startsWith('delete')) {
    return { type: 'delete', unit: deleteUnitOf(inputType), forward: !inputType.endsWith('Backward') }
  }
  if (inputType === 'insertText') return { type: 'insert', text: data, coalesce: data.length === 1 }
  if (inputType === 'insertLineBreak' || inputType === 'insertParagraph') return { type: 'newline' }
  if (inputType === 'insertFromPaste' || inputType === 'insertFromDrop') {
    return { type: 'insert', text: pasted, coalesce: false }
  }
  return inputType.startsWith('format') ? { type: 'ignore' } : { type: 'pass' }
}
