<script setup lang="ts">
import { computed, onBeforeUnmount, onBeforeUpdate, onMounted, ref } from 'vue'
import { createEditHistory } from '../../lib/markup/editHistory'
import type { EditKind } from '../../lib/markup/editHistory'
import {
  backspace,
  clampState,
  deleteForward,
  insertText as insertTextInto,
  normalizeText,
  selectionText,
} from '../../lib/markup/richText'
import type { RichTextState, TextSpan } from '../../lib/markup/richText'
import {
  editIntentOf,
  mountRichText,
  offsetFromPoint,
  projectRichText,
  readSelection,
  revealCaret,
  serializeRichText,
  spanOfNode,
  writeSelection,
} from '../../lib/markup/richTextDom'
import { itemIconUrl } from '../../lib/markup/itemIcons'

/**
 * 可编辑的富文本字段（两层结构）
 *
 * 真相是一段带 `\tag;` 标记的纯文本，DOM 只是它的投影: 浏览器事件 → 原文上的一次替换 →
 * 重画投影 → 光标按字符偏移放回去。撤销栈也建在原文上，不借浏览器的编辑模型；
 * 只有 onInput 那条兜底会反过来读 DOM（浏览器自己动过 DOM 的情况）。
 */
const props = withDefaults(defineProps<{
  /** 原始文本（带 `\tag;` 标记） */
  modelValue: string
  /** input 单行 / area 多行 / label 属性名 */
  variant?: 'input' | 'area' | 'label'
  /** 内容为空时的占位文字 */
  placeholder?: string
  /** 带「插入图标」按钮 */
  iconButton?: boolean
  /** 字数上限，超出的输入直接吞掉；0 = 不限 */
  maxLength?: number
}>(), {
  variant: 'input',
  placeholder: '',
  iconButton: false,
  maxLength: 0,
})

/** 给外面用的插入口（图标选择器往字段里插图标） */
export interface RichTextApi {
  /**
   * 在光标处插一段文本（有选区就替换掉那一块），原样插入 —— 画不画成图标是显示层的事
   *
   * @returns 空串 / 到字数上限 → false
   */
  insertText: (text: string) => boolean
  /** 字段容器（浮层贴着它弹） */
  anchor: HTMLElement | null
}

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'icon', api: RichTextApi): void
}>()

const el = ref<HTMLElement | null>(null)

/* ── 第一层: 原始文本 ────────────────────────────────── */

/** 原始文本（唯一真相） */
const text = ref(normalizeText(props.modelValue))
/** 光标 / 选区: 原文里的字符偏移（浮层抢走焦点后 Range 会失效，偏移不会） */
const sel = ref<TextSpan>({ start: text.value.length, end: text.value.length })

/** 投影: 文本 → 节点表 */
const nodes = computed(() => projectRichText(text.value, { resolveIcon: itemIconUrl }))
/** 真画成图标的标记: 删除时整体算一个原子 */
const atoms = computed<TextSpan[]>(() => nodes.value
  .filter((node) => node.kind === 'icon')
  .map((node) => ({ start: node.start, end: node.end })))

/** 空字段（占位符靠它，不靠 `:empty`） */
const blank = computed(() => !text.value)

/** 撤销 / 重做（快照建在原文上，和 DOM 无关） */
const history = createEditHistory<RichTextState>({ limit: 200, coalesceMs: 600 })

/** 输入法组词中（这期间 DOM 归浏览器） */
const composing = ref(false)
/** 组词开始时的选区: 提交时按它落文本 */
let composingAt: TextSpan = { start: 0, end: 0 }
/** 刚提交完一次组词（浏览器补发的那个 input 要忽略一次） */
let justComposed = false
let justComposedTimer = 0

/* ── 投影 / 光标 ─────────────────────────────────────── */

/** 当前状态（原文 + 选区） */
function current(): RichTextState {
  return { text: text.value, start: sel.value.start, end: sel.value.end }
}

/** 重画投影，并把光标放回去 */
function paint() {
  const node = el.value
  if (!node || composing.value) return
  mountRichText(node, nodes.value)
  if (document.activeElement === node) {
    writeSelection(node, sel.value.start, sel.value.end)
    revealCaret(node)
  }
}

/** 直接落一个状态（撤销 / 重做走它: 不再记历史） */
function apply(next: RichTextState) {
  const changed = next.text !== text.value
  text.value = next.text
  sel.value = { start: next.start, end: next.end }
  paint()
  if (changed) emit('update:modelValue', next.text)
}

/** 记一步历史再落状态（用户操作都走这里） */
function commit(next: RichTextState, kind: EditKind, coalesce = false) {
  if (next.text === text.value && next.start === sel.value.start && next.end === sel.value.end) return
  history.record(current(), kind, coalesce)
  apply(next)
}

/** 从 DOM 读回光标（点击、方向键、拖选都靠它） */
function syncSelection() {
  const node = el.value
  if (!node) return
  const range = readSelection(node)
  if (range) sel.value = range
  revealCaret(node)
}

/** 选区一变就同步过来（只在聚焦期间监听，字段多时不至于挂一堆监听器） */
function onSelectionChange() {
  if (composing.value) return
  if (document.activeElement === el.value) syncSelection()
}

/** 聚焦: 只读光标不写（点哪儿落哪儿由浏览器决定） */
function onFocus() {
  document.addEventListener('selectionchange', onSelectionChange)
  syncSelection()
}

function onBlur() {
  document.removeEventListener('selectionchange', onSelectionChange)
  syncSelection()
  // 单行字段失焦后回到开头（跟普通输入框一样），别停在文字末尾那一截
  if (props.variant !== 'area' && el.value) el.value.scrollLeft = 0
}

/* ── 编辑操作 ────────────────────────────────────────── */

/**
 * 字段收得下的文本（打字 / 粘贴 / 拖放 / 输入法上屏都过这里）
 *
 * emoji（基本平面以外的字符）一律过滤: 游戏那边只收基本平面、字体也画不出来，还免得留下
 * 会让蓝图编码失败的"半个 emoji"。单行字段再去掉换行和制表符（一个换行就把那行撑成两行）。
 */
function insertable(value: string): string {
  const plain = value.replace(/[\uD800-\uDFFF]/g, '')
  return props.variant === 'area' ? plain : plain.replace(/[\n\t]/g, '')
}

/** 往光标处插文字（打字 / 粘贴 / 拖放 / 换行共用）；超上限按整个标记掐，放不下就什么都不做 */
function typeText(value: string, kind: EditKind = 'insert', coalesce = false) {
  const text = insertable(value)
  if (!text) return
  commit(insertTextInto(current(), text, props.maxLength), kind, coalesce)
}

/** 回车: 多行字段换行，单行字段结束编辑 */
function newline() {
  if (props.variant === 'area') typeText('\n')
  else el.value?.blur()
}

function undo() {
  const state = history.undo(current())
  if (state) apply(state)
}

function redo() {
  const state = history.redo(current())
  if (state) apply(state)
}

/* ── 输入管线 ────────────────────────────────────────── */

/**
 * 一切输入的总入口
 *
 * 认得的输入一律 preventDefault，然后在原文上自己算一次替换 —— 不让浏览器也改一遍 DOM，
 * 不会出现"它改了一半、我们改了一半"；认不出的（pass）留给 onInput 兜底。
 */
function onBeforeInput(e: Event) {
  // 组词交给浏览器，compositionend 再一次性收口
  if (composing.value) return

  const ev = e as InputEvent
  const intent = editIntentOf(
    ev.inputType ?? '',
    ev.data ?? '',
    ev.dataTransfer?.getData('text/plain') ?? '',
  )
  if (intent.type === 'pass') return
  ev.preventDefault()

  if (intent.type === 'undo') undo()
  else if (intent.type === 'redo') redo()
  else if (intent.type === 'newline') newline()
  else if (intent.type === 'insert') typeText(intent.text, 'insert', intent.coalesce)
  else if (intent.type === 'delete') {
    const state = current()
    const next = intent.forward
      ? deleteForward(state, intent.unit, atoms.value)
      : backspace(state, intent.unit, atoms.value)
    commit(next, `delete-${intent.unit}`, intent.unit === 'char')
  }
  // ignore: 拦下就行（格式命令之类）
}

/**
 * 输入落地之后的兜底
 *
 * 正常路径上不该有事件（前面已经 preventDefault 自己算了）；真来了（自动填充、拼写修正…）
 * 就把 DOM 读回来当新原文，粒度粗但绝不吞字符。
 */
function onInput() {
  if (composing.value) return
  if (justComposed) {
    justComposed = false
    return
  }

  const node = el.value
  if (!node) return
  const raw = serializeRichText(node)
  if (raw === text.value) return

  // 浏览器自己塞进来的也按字段规矩过滤: 过滤完和原文一样，说明塞的全是装不下的字符，擦回投影即可
  const dom = insertable(raw)
  if (dom === text.value) {
    paint()
    return
  }

  const range = readSelection(node) ?? { start: dom.length, end: dom.length }
  commit({
    text: dom,
    start: Math.min(range.start, dom.length),
    end: Math.min(range.end, dom.length),
  }, 'adopt')
}

function onCompositionStart() {
  composing.value = true
  syncSelection()
  composingAt = { ...sel.value }
}

/**
 * 组词结束: 一次把上屏的内容落到原文上
 *
 * 组词期间浏览器往 DOM 里塞的中间态不用清理 —— 按最终文本重画一遍投影就没了。
 */
function onCompositionEnd(e: Event) {
  composing.value = false
  // 提交时浏览器还会补发一个 input 事件（各浏览器顺序不同）: 忽略掉，别把中间态当成内容
  justComposed = true
  window.clearTimeout(justComposedTimer)
  justComposedTimer = window.setTimeout(() => { justComposed = false }, 0)

  const data = (e as CompositionEvent).data ?? ''
  if (!data) {
    // 组词被取消（Esc）: 原文没变，只把 DOM 擦回投影
    paint()
    return
  }

  const before: RichTextState = { text: text.value, start: composingAt.start, end: composingAt.end }
  commit(insertTextInto(before, insertable(data), props.maxLength), 'insert')
  paint()
}

function onKeydown(e: KeyboardEvent) {
  // 组词中: 回车是"上屏"，不是"结束编辑"
  if (e.isComposing || composing.value) return

  if ((e.ctrlKey || e.metaKey) && !e.altKey) {
    const key = e.key.toLowerCase()
    if (key === 'z') {
      e.preventDefault()
      if (e.shiftKey) redo()
      else undo()
      return
    }
    if (key === 'y') {
      e.preventDefault()
      redo()
      return
    }
  }

  if (e.key !== 'Enter') return
  // 多行字段的换行走 beforeinput（insertParagraph），这里只管单行的"回车结束编辑"
  if (props.variant === 'area') return
  e.preventDefault()
  el.value?.blur()
}

/* ── 剪贴板 ──────────────────────────────────────────── */

/**
 * 复制: 按选区切原文（图标还原成 `\tiek;`），只写 text/plain
 *
 * 不写 text/html —— 那会把图标复制成 `<img>` 的 alt（物品名）。
 */
function onCopy(e: ClipboardEvent) {
  const value = selectionText(current())
  if (!value || !e.clipboardData) return
  e.clipboardData.setData('text/plain', value)
  e.preventDefault()
}

/** 剪切: 复制 + 从原文删掉选区（可撤销） */
function onCut(e: ClipboardEvent) {
  const state = current()
  const value = selectionText(state)
  if (!value) return
  e.clipboardData?.setData('text/plain', value)
  e.preventDefault()
  commit(backspace(state, 'char', atoms.value), 'cut')
}

/** 粘贴 / 拖放: 一律当纯文本自己往原文里插（不让浏览器往 DOM 里插），一次粘贴占一步撤销 */
function onPaste(e: ClipboardEvent) {
  e.preventDefault()
  typeText(e.clipboardData?.getData('text/plain') ?? '')
}

function onDrop(e: DragEvent) {
  e.preventDefault()
  const node = el.value
  // 落点由鼠标给，不一定是当前光标
  const at = node ? offsetFromPoint(node, e.clientX, e.clientY) : null
  if (at !== null) sel.value = { start: at, end: at }
  typeText(e.dataTransfer?.getData('text/plain') ?? '')
}

/* ── 鼠标 ────────────────────────────────────────────── */

/**
 * 点在图标上的定位: 按左半边还是右半边，把光标放到图标前 / 后
 *
 * Chromium 把 contenteditable 里的 `<img>` 当整体，点它一律把光标放到后面，
 * 于是连续图标之间插不进光标。
 */
function onMouseDown(e: MouseEvent) {
  const node = el.value
  const target = e.target as HTMLElement | null
  if (!node || !target || target.tagName !== 'IMG') return

  const span = target.dataset.markup ? spanOfNode(node, target) : null
  if (!span) return

  const rect = target.getBoundingClientRect()
  const offset = e.clientX >= rect.left + rect.width / 2 ? span.end : span.start

  // 拦掉默认行为，否则浏览器随后又会按它自己的规则把光标挪到图标后面；聚焦也一并自己补上
  e.preventDefault()
  node.focus()
  sel.value = { start: offset, end: offset }
  writeSelection(node, offset)
}

/* ── 给外面用的插入口 ────────────────────────────────── */

/**
 * 在光标处插一段文本（图标选择器用）
 *
 * 焦点可能已经不在字段里，所以先定光标位置，再把焦点放回去。
 */
function insertText(text: string): boolean {
  const node = el.value
  if (!node || !text) return false

  // 焦点还在字段里就以 DOM 光标为准，否则用记下的位置；位置要在聚焦之前定下来
  if (document.activeElement === node) syncSelection()
  const state = current()

  const next = insertTextInto(state, insertable(text), props.maxLength)
  if (next.text === state.text) return false

  // 焦点放回字段（多数时候它本来就在），插进去之后光标才看得见
  if (document.activeElement !== node) node.focus()
  commit(next, 'insert-text')
  return true
}

defineExpose({ insertText, anchor: el })

function onIconButtonClick() {
  // 交出原始 DOM 元素（不是 ref）: 父组件要拿它量浮层位置
  emit('icon', { insertText, anchor: el.value })
}

/* ── 生命周期 ────────────────────────────────────────── */

onMounted(() => paint())

onBeforeUnmount(() => {
  document.removeEventListener('selectionchange', onSelectionChange)
  window.clearTimeout(justComposedTimer)
})

/**
 * 外部换了内容（打开新蓝图 / 重置信息 / 换属性行）: 接过来重画
 *
 * 挂在 onBeforeUpdate 而不是 `watch(props.modelValue)`: props 变了就一定会走到这里，
 * 而 watcher 和它共用一条调度队列，实测出现过要等下一轮 flush 才跑（框里还留着上一份文字）。
 */
function adoptExternal(value: string) {
  const next = normalizeText(value)
  if (next === text.value) return

  const clamped = clampState({ text: next, start: sel.value.start, end: sel.value.end })
  text.value = clamped.text
  sel.value = { start: clamped.start, end: clamped.end }
  // 换了一份内容: 旧快照指向上一份文本，不能再撤回去
  history.clear()
  // 横向滚动也回到开头，别停在上一份内容滚到的位置（不聚焦时 paint 不会去管光标）
  if (el.value) el.value.scrollLeft = 0
  paint()
}

onBeforeUpdate(() => adoptExternal(props.modelValue))
</script>

<template>
  <!-- 多行字段（蓝图介绍）的按钮抬到框外右上角（单行框里它在框内右侧正合适） -->
  <div
    class="factory-rich-field"
    :class="{ 'btn-outside': iconButton && variant === 'area' }"
  >
    <!-- 内容由投影（mountRichText）填，模板里留空 —— Vue 不碰它的子节点 -->
    <div
      ref="el"
      class="factory-rich-edit"
      :class="[`is-${variant}`, { 'is-blank': blank && !composing }]"
      contenteditable="true"
      spellcheck="false"
      dir="ltr"
      role="textbox"
      :aria-multiline="variant === 'area'"
      :data-placeholder="placeholder"
      @mousedown="onMouseDown"
      @beforeinput="onBeforeInput"
      @input="onInput"
      @compositionstart="onCompositionStart"
      @compositionend="onCompositionEnd"
      @keydown="onKeydown"
      @paste="onPaste"
      @drop="onDrop"
      @copy="onCopy"
      @cut="onCut"
      @focus="onFocus"
      @blur="onBlur"
    ></div>
    <!-- mousedown 会把焦点移到按钮上、输入框一失焦光标就看不见了: 整块 prevent 掉（点一下照样触发 click） -->
    <button
      v-if="iconButton"
      class="factory-icon-btn"
      type="button"
      aria-label="插入图标"
      @mousedown.prevent
      @click="onIconButtonClick"
    >
      <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
        <rect x="1.5" y="1.5" width="5" height="5" rx="1" />
        <rect x="9.5" y="1.5" width="5" height="5" rx="1" />
        <rect x="1.5" y="9.5" width="5" height="5" rx="1" />
        <path d="M12 9.5v5M9.5 12h5" />
      </svg>
    </button>
  </div>
</template>
