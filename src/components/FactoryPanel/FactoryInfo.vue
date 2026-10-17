<script setup lang="ts">
import { computed, reactive } from 'vue'
import {
  pathText,
  factory,
  facilities,
  buildingCount,
  foundationTotal,
  foundationDecal,
  foundationUndecal,
  hasFoundation,
  LIMITS,
} from '../../stores/factory'
import { itemIconUrl } from '../../lib/markup/itemIcons'
import type { IconRef } from '../../lib/markup/itemIcons'
import { ICON_CATEGORIES } from '../../lib/markup/iconCatalog'
import { useToast } from '../../composables/useToast'
import decalIcon from '../../assets/factory/decal.png'
import undecalIcon from '../../assets/factory/undecal.png'
import RichTextEditor, { type RichTextApi } from './RichTextEditor.vue'
import FactoryThumb, { LAYOUT_OPTIONS, NO_LAYOUT } from './FactoryThumb.vue'
import IconPickerModal from './IconPickerModal.vue'

const toast = useToast()

/** 图标选择器状态: slot >= 0 给缩略图图标位选，editor 非空往那个字段的光标处插，anchor 是浮层贴的元素 */
const picker = reactive({
  open: false,
  slot: -1,
  editor: null as RichTextApi | null,
  current: 0,
  anchor: null as HTMLElement | null,
  /** 默认分类名 */
  defaultCategory: '物品',
})

/** 这次打开图标位期间有没有选过图标（没选就关 = 清除这一位，见 closePicker） */
let slotPicked = false

/**
 * 下拉框选中的图标布局
 *
 * 选项里没有的编号（比如 0 = None，或者表外的编号）在界面上也按「无」显示，
 * 但不动头部里存的值 —— 要等用户真去选一下才写回去
 */
const layoutChoice = computed({
  get: () => (LAYOUT_OPTIONS.some((opt) => opt.value === factory.header.layout) ? factory.header.layout : NO_LAYOUT),
  set: (value: number) => { factory.header.layout = Number(value) || NO_LAYOUT },
})

/** 点缩略图图标位（槽位与选中值由缩略图组件给） */
function openSlotPicker(index: number, itemId: number, e: MouseEvent) {
  picker.slot = index
  picker.editor = null
  picker.current = itemId
  picker.anchor = e.currentTarget as HTMLElement
  picker.open = true
  slotPicked = false
}

/** 右键缩略图图标位 = 清掉这一位（id 0 = 空） */
function onClearSlot(index: number) {
  factory.header.icons[index] = 0
}

/** 点字段上的「插入图标」按钮（浮层贴着这个字段弹） */
function openTextPicker(api: RichTextApi) {
  picker.slot = -1
  picker.editor = api
  picker.current = 0
  picker.anchor = api.anchor
  picker.open = true
}

/** 选中一个图标: 给缩略图槽位就写进那一位，给字段就往光标处插 */
function onPickIcon(icon: IconRef) {
  const markup = icon.markup ?? ''
  if (picker.slot >= 0) {
    // 缩略图槽位只认 id（id 0 = 清空这一位）
    slotPicked = true
    factory.header.icons[picker.slot] = icon.id
  } else if (picker.editor && markup) {
    // 到字数上限时插入会被吞掉，给个提示（不然点了图标毫无反应）
    if (!picker.editor.insertText(markup)) toast.show('这个字段已经到字数上限了')
  }
  // 关不关由选择器决定（钉住时可以连着插）；这里只把选中结果交出去
}

/** 关掉浮层: 图标位这次一个都没选就当作「清除这一位」 */
function closePicker() {
  if (picker.slot >= 0 && !slotPicked) factory.header.icons[picker.slot] = 0
  picker.open = false
  picker.slot = -1
  picker.editor = null
  picker.anchor = null
}

/** 设施清单 + 图标 URL */
const facList = computed(() => facilities.value.map((item) => ({
  ...item,
  icon: itemIconUrl(item.itemId),
})))

/** 「带装饰地基 / 无装饰地基」两个图标 */
const reformIcons = {
  decal: decalIcon,
  undecal: undecalIcon,
}
</script>

<template>
  <div class="factory-info">
    <div class="factory-info-top">
      <div class="factory-fields">
        <div class="factory-field">
          <label>蓝图文件</label>
          <!-- 用 div 不用 input: 只读的 input 仍然能被聚焦，会亮起蓝色焦点边框 -->
          <div class="factory-input" :class="{ empty: !pathText }">
            {{ pathText || '尚未打开蓝图' }}
          </div>
        </div>

        <div class="factory-row">
          <div class="factory-field grow">
            <label>缩略图文字</label>
            <div class="factory-input">
              <RichTextEditor
                v-model="factory.header.shortDesc"
                icon-button
                :max-length="LIMITS.shortDesc"
                @icon="openTextPicker"
              />
            </div>
          </div>
          <div class="factory-field w-layout">
            <label>图标布局</label>
            <select
              v-model.number="layoutChoice"
              class="factory-input factory-layout-select"
            >
              <option v-for="opt in LAYOUT_OPTIONS" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </option>
            </select>
          </div>
        </div>

        <div class="factory-row">
          <div class="factory-field grow">
            <label>作者</label>
            <div class="factory-input">
              <RichTextEditor
                v-model="factory.header.author"
                icon-button
                :max-length="LIMITS.author"
                @icon="openTextPicker"
              />
            </div>
          </div>
          <div class="factory-field w-layout">
            <label>版本</label>
            <div class="factory-input">
              <RichTextEditor
                v-model="factory.header.customVersion"
                icon-button
                :max-length="LIMITS.customVersion"
                @icon="openTextPicker"
              />
            </div>
          </div>
        </div>
      </div>

      <div class="factory-thumb-col">
        <FactoryThumb
          :layout="factory.header.layout"
          :icons="factory.header.icons"
          :short-desc="factory.header.shortDesc"
          @pick-slot="openSlotPicker"
          @clear-slot="onClearSlot"
        />
        <button
          class="btn-sm factory-new-attr"
          type="button"
          :disabled="factory.header.properties.length >= LIMITS.properties"
          @click="factory.header.properties.push({ key: '', value: '' })"
        >新建属性</button>
      </div>
    </div>

    <!-- 属性: 名称右边的 × 或右键整行都能删 -->
    <div
      v-for="(prop, index) in factory.header.properties"
      :key="index"
      class="factory-field"
      @contextmenu.prevent="factory.header.properties.splice(index, 1)"
    >
      <div class="factory-prop-head">
        <!-- 用 div 而不是 label: label 会把点击转发给里面的图标按钮，一点就弹选择器 -->
        <div class="factory-prop-label">
          <RichTextEditor
            v-model="prop.key"
            variant="label"
            placeholder="新属性"
            icon-button
            :max-length="LIMITS.propertyKey"
            @icon="openTextPicker"
          />
        </div>
        <button
          class="factory-prop-remove"
          type="button"
          @click="factory.header.properties.splice(index, 1)"
        >×</button>
      </div>
      <div class="factory-input">
        <RichTextEditor
          v-model="prop.value"
          icon-button
          :max-length="LIMITS.propertyValue"
          @icon="openTextPicker"
        />
      </div>
    </div>

    <!-- 介绍 -->
    <div class="factory-field">
      <label>蓝图介绍</label>
      <div class="factory-desc">
        <RichTextEditor
          v-model="factory.header.desc"
          variant="area"
          icon-button
          :max-length="LIMITS.desc"
          @icon="openTextPicker"
        />
      </div>
    </div>

    <!-- 包含设施 -->
    <div class="factory-fac-head">
      <span class="factory-fac-title">包含设施</span>
      <span class="factory-fac-sum">{{ buildingCount }}个设施</span>
    </div>

    <div class="factory-fac-grid">
      <div
        v-for="item in facList"
        :key="item.itemId"
        class="factory-fac"
        :title="`${item.name} ×${item.count}`"
      >
        <img v-if="item.icon" class="factory-icon" :src="item.icon" :alt="item.name" />
        <span v-else class="factory-fac-name">{{ item.name }}</span>
        <span class="factory-fac-count">{{ item.count }}</span>
      </div>
    </div>

    <!-- 包含地基（在「包含设施」下面单列一块，只有铺过地基才出现） -->
    <template v-if="hasFoundation">
      <div class="factory-fac-head">
        <span class="factory-fac-title">包含地基</span>
        <span class="factory-fac-sum">{{ foundationTotal }}个地基</span>
        <span class="factory-fac-note">暂不支持显示地基</span>
      </div>
      <div class="factory-fac-grid">
        <div
          v-if="foundationDecal > 0"
          class="factory-fac"
          :title="`带装饰地基 ×${foundationDecal}`"
        >
          <img class="factory-icon" :src="reformIcons.decal" alt="带装饰地基" />
          <span class="factory-fac-count">{{ foundationDecal }}</span>
        </div>
        <div
          v-if="foundationUndecal > 0"
          class="factory-fac"
          :title="`无装饰地基 ×${foundationUndecal}`"
        >
          <img class="factory-icon" :src="reformIcons.undecal" alt="无装饰地基" />
          <span class="factory-fac-count">{{ foundationUndecal }}</span>
        </div>
      </div>
    </template>

    <!-- 创建信息 -->
    <div class="factory-meta">
      <span>创建版本号 {{ factory.header.gameVersion || '—' }}</span>
      <span class="factory-meta-right">创建时间 {{ factory.header.time || '—' }}</span>
    </div>
  </div>

  <IconPickerModal
    :open="picker.open"
    :categories="ICON_CATEGORIES"
    :default-category="picker.defaultCategory"
    :current="picker.current"
    :show-pin="picker.slot < 0"
    :anchor="picker.anchor"
    @select="onPickIcon"
    @close="closePicker"
  />
</template>

<style scoped>
.factory-info {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.factory-info-top {
  display: flex;
  /* 拉伸: 缩略图栏拿到整行高度，缩略图的上下自动边距才有空间分配 */
  align-items: stretch;
  gap: 12px;
  min-width: 0;
}

.factory-fields {
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex: 1;
  /* 栏位收窄时先让右边缩略图变小，字段栏保住可读宽度 */
  min-width: 200px;
}

.factory-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  min-width: 0;
}

.factory-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  position: relative;
}

/* 属性名那一格由 RichTextEditor 的 label 变体渲染 */
.factory-field label,
.factory-prop-label {
  font-size: 12px;
  color: var(--fg-secondary);
}

.factory-field.grow {
  flex: 1 1 140px;
}

.factory-field.w-layout {
  width: 92px;
  flex: 0 0 auto;
}

/* 只读文本块与可编辑字段共用一副长相 */
.factory-input,
.factory-desc {
  width: 100%;
  box-sizing: border-box;
  padding: 5px 8px;
  border-radius: 6px;
  border: 1px solid var(--line-strong);
  background: #16233c;
  color: var(--fg-strong);
  font-size: 13px;
  font-family: inherit;
}

.factory-input:focus,
.factory-desc:focus,
.factory-input:focus-within,
.factory-desc:focus-within {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 1px rgba(67, 100, 235, 0.35);
}

.factory-input {
  min-height: 27px;
  line-height: 17px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.factory-input.empty {
  color: var(--fg-muted);
}

/* 高度跟着内容长，超长时整组变高由外面那一栏滚动，不做框内滚动 */
.factory-desc {
  line-height: 20px;
  white-space: pre-wrap;
  min-height: 96px;
}

/* 箭头用背景画，避开各浏览器默认样式差异 */
.factory-layout-select {
  appearance: none;
  -webkit-appearance: none;
  padding-right: 18px;
  cursor: pointer;
  background-image:
    linear-gradient(45deg, transparent 50%, #bcc8e0 50%),
    linear-gradient(135deg, #bcc8e0 50%, transparent 50%);
  background-position: calc(100% - 11px) 12px, calc(100% - 7px) 12px;
  background-size: 5px 5px, 5px 5px;
  background-repeat: no-repeat;
}

.factory-layout-select option {
  background: #16233c;
  color: var(--fg-strong);
}

/* 宽度在 96 ~ 132px 之间伸缩 */
.factory-thumb-col {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 0 1 132px;
  min-width: 96px;
}

.factory-new-attr {
  width: 100%;
  min-width: 0;
}

.factory-prop-head {
  display: flex;
  align-items: center;
  gap: 4px;
}

.factory-prop-head .factory-prop-label {
  /* 名称输入框占 1/3 宽（最窄 100px） */
  flex: 0 0 35%;
  min-width: 100px;
  box-sizing: border-box;
  padding-right: 6px;
  border-right: 1px solid var(--line);
}

.factory-prop-remove {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--fg-muted);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}

.factory-prop-remove:hover {
  background: rgba(255, 120, 120, 0.15);
  color: var(--danger);
}

.factory-fac-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 10px;
  padding-top: 8px;
  border-top: 1px solid var(--line);
}

.factory-fac-title {
  font-size: 13px;
  font-weight: bold;
  color: var(--fg);
}

.factory-fac-sum {
  font-size: 12px;
  color: var(--fg-secondary);
}

/* 标题右边的说明: 暂不支持显示地基 */
.factory-fac-note {
  margin-left: auto;
  font-size: 12px;
  font-weight: normal;
  color: var(--fg-muted);
}

.factory-fac-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-height: 20px;
}

.factory-fac {
  position: relative;
  width: 54px;
  height: 54px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 3px;
  border-radius: 7px;
  border: 1px solid var(--line-strong);
  background: #16233c;
  color: var(--fg-value);
  font-size: 9px;
  line-height: 1.15;
  text-align: center;
  overflow: hidden;
}

/* 没有图标时退化成名字（最多三行） */
.factory-fac-name {
  display: -webkit-box;
  line-clamp: 3;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-all;
}

.factory-fac-count {
  position: absolute;
  right: 2px;
  bottom: 1px;
  font-size: 10px;
  font-weight: bold;
  color: #6ea8ff;
  text-shadow: 0 0 3px #000, 0 1px 2px #000;
}

.factory-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  padding-top: 8px;
  border-top: 1px solid var(--line);
  font-size: 12px;
  color: var(--fg-secondary);
}

.factory-meta-right {
  margin-left: auto;
}
</style>
