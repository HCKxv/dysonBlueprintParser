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
import decalIcon from '../../assets/icons/reform/decal.png'
import undecalIcon from '../../assets/icons/reform/undecal.png'
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
          @clear-slot="(index) => (factory.header.icons[index] = 0)"
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
          aria-label="删除这条属性"
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
