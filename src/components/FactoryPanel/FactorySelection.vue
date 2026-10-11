<script setup lang="ts">
/** 详情: 预览里点中的那栋建筑 */
import { computed, reactive, watch } from 'vue'
import { editBuilding, editLabGroup, linkedLabBuildings, selectedBuilding, selectedBuildingCoord } from '../../stores/factory'
import { isAssembler, isBelt, isInserter, isLab, isStation, itemName } from '../../lib/blueprint/factory/factoryItems.js'
import { cloneData } from '../../lib/blueprint/clonePlain.js'
import { itemIconUrl } from '../../lib/markup/itemIcons'
import type { IconCategories } from '../../lib/markup/itemIcons'
import { ICON_CATEGORIES } from '../../lib/markup/iconCatalog'
import { useToast } from '../../composables/useToast'
import FactoryAssembler from './FactoryAssembler.vue'
import FactoryBelt from './FactoryBelt.vue'
import FactoryInserter from './FactoryInserter.vue'
import FactoryStation from './FactoryStation.vue'

const toast = useToast()

/** 图标与名字 */
const icon = computed(() => (selectedBuilding.value ? itemIconUrl(selectedBuilding.value.itemId) : ''))
const name = computed(() => (selectedBuilding.value ? itemName(selectedBuilding.value.itemId) : ''))

/** 网格坐标（格） */
const coord = computed(() => selectedBuildingCoord.value)
/** 原始坐标 */
const BPcoord = computed(() => selectedBuilding.value?.localOffset?.[0] ?? null)

/** 坐标数值 */
function num(value: number) {
  const ticks = Math.round(Math.abs(value) * 10000) // 先回到 4 位小数的整数刻度
  const rounded = Math.sign(value) * Math.round(ticks / 100) / 100
  return String(rounded === 0 ? 0 : rounded) // -0 收成 0
}

/** 暂存的改动 */
const staged = reactive<Record<string, any>>({})

/**
 * 建筑参数（用来显示）
 */
const parameters = computed(() => staged.parameters ?? selectedBuilding.value?.parameters ?? {})

/**
 * 拿到「正在编辑的建筑参数」: 第一次改时拷一份。
 * 用 cloneData 而不是 structuredClone —— 选中建筑的参数是 Vue 响应式代理，克隆代理会抛 DataCloneError
 */
function editParameters(): Record<string, any> {
  if (staged.parameters === undefined) {
    const current = selectedBuilding.value?.parameters
    staged.parameters = current ? cloneData(current) : {}
  }
  return staged.parameters
}

/** 子组件改了一项参数: 落进暂存（点保存才写回蓝图） */
function onParametersChange(key: string, value: unknown) {
  editParameters()[key] = value
}

/** 物品栏图标选择器用的分类: 「物品」+「建筑」 */
const itemIcons = computed<IconCategories>(() => {
  const out: IconCategories = {}
  for (const name of ['物品', '建筑']) {
    const list = ICON_CATEGORIES[name]
    if (list) out[name] = list
  }
  return out
})

/** 有没有改过 */
const dirty = computed(() => Object.keys(staged).length > 0)

/** 这栋连在一起的研究站有几个；不是研究站给 0。 */
const labCount = computed(() => (isLab(selectedBuilding.value?.itemId)
  ? linkedLabBuildings(Number(selectedBuilding.value?.index)).length
  : 0))

/** 保存: 把改过的项交出 */
function onSave() {
  const building = selectedBuilding.value
  if (!building || !dirty.value) return

  const changes: Record<string, any> = {}
  if (staged.recipeId !== undefined) changes.recipeId = staged.recipeId
  if (staged.filterId !== undefined) changes.filterId = staged.filterId
  if (staged.parameters !== undefined) changes.parameters = staged.parameters

  // 研究站按「整栋」保存: 连同相连的那些一起改
  const lab = isLab(building.itemId)
  const ok = lab ? editLabGroup(Number(building.index), changes) : editBuilding(building.index, changes)
  toast.show(ok ? '已保存该建筑的修改' : '保存失败：没找到该建筑')
}

/** 清空暂存 */
function resetStaged() {
  for (const key of Object.keys(staged)) delete staged[key]
}
watch(selectedBuilding, resetStaged)

</script>

<template>
  <div v-if="selectedBuilding" class="factory-selection">
    <div class="factory-selection-row">
      <span class="factory-selection-index">#{{ selectedBuilding.index }}</span>
      <div class="factory-selection-title">
        <img v-if="icon" class="factory-icon factory-selection-icon" :src="icon" :alt="name" />
        <span class="factory-selection-name">{{ name }}</span>
      </div>
      <span v-if="labCount > 1" class="factory-selection-group">×{{ labCount }}</span>
      <span v-if="coord" class="factory-selection-coord">
        <span>位置 ({{ num(coord.x) }}, {{ num(coord.y) }})</span>
        <span>高 {{ num(coord.z) }}</span>
        <span class="factory-selection-coord-hint"
          :title= "`原始坐标：x=${BPcoord.x}, y=${BPcoord.y}, z=${BPcoord.z}`">
          <svg viewBox="0 0 16 16">
            <circle cx="8" cy="8" r="6.8" />
            <path
              class="factory-selection-coord-hint-mark"
              d="M6.1 6A2 2 0 0 1 9.99 6.67c0 1.33-2 2-2 2"
            />
            <circle class="factory-selection-coord-hint-dot" cx="8" cy="11.4" r="0.88" />
          </svg>
        </span>
      </span>
    </div>

    <!-- 制造设备 -->
    <FactoryAssembler
      v-if="isAssembler(selectedBuilding.itemId) || isLab(selectedBuilding.itemId)"
      :key="selectedBuilding.index"
      :item-id="Number(selectedBuilding.itemId)"
      :recipe-id="Number(staged.recipeId ?? selectedBuilding.recipeId ?? 0)"
      :parameters="parameters"
      @change="onParametersChange"
      @update:recipe-id="(v) => (staged.recipeId = v)"
    />

    <!-- 传送带 -->
    <FactoryBelt
      v-if="isBelt(selectedBuilding.itemId)"
      :key="selectedBuilding.index"
      :parameters="parameters"
      :item-icons="ICON_CATEGORIES"
      @change="onParametersChange"
    />

    <!-- 分拣器 -->
    <FactoryInserter
      v-if="isInserter(selectedBuilding.itemId)"
      :key="selectedBuilding.index"
      :length="Number(parameters?.length ?? 0)"
      :filter-id="Number(staged.filterId ?? selectedBuilding.filterId ?? 0)"
      :item-icons="itemIcons"
      @update:filter-id="(v) => (staged.filterId = v)"
    />

    <!-- 物流运输站类（2103 行星内 / 2104 星际 / 2316 大型采矿机） -->
    <FactoryStation
      v-if="isStation(selectedBuilding.itemId)"
      :key="selectedBuilding.index"
      :item-id="Number(selectedBuilding.itemId)"
      :parameters="parameters"
      :item-icons="itemIcons"
      @change="onParametersChange"
    />

    <!-- 编辑: 有改动才可点 -->
    <div class="factory-selection-actions">
      <button
        class="btn-sm factory-selection-save"
        type="button"
        :disabled="!dirty"
        @click="onSave"
      >保存</button>
    </div>
  </div>
  <div v-else class="factory-selection-empty">未选择建筑</div>
</template>

<style scoped>
.factory-selection {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 8px 0;
}

.factory-selection-index {
  font-size: 14px;
  font-weight: bold;
  color: #6ea8ff;
}

.factory-selection-title {
  display: flex;
  align-items: center;
  min-width: 0;
}

/* 图标与参数字行的样式都是两处以上在用，见 styles/shared.css */

.factory-selection-name {
  font-size: 18px;
  color: var(--fg);
}

/* 贴行尾；等宽数字，换建筑时不左右抖 */
.factory-selection-coord {
  display: inline-flex;
  gap: 8px;
  margin-left: auto;
  flex-shrink: 0;
  font-size: 11px;
  color: #8fa3c8;
  font-variant-numeric: tabular-nums;
}

/* 问号提示 */
.factory-selection-coord-hint {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  opacity: 0.8;
}

/* 线性圆圈 + 问号，颜色从坐标行继承 */
.factory-selection-coord-hint svg {
  display: block;
  width: 12px;
  height: 12px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.15;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.factory-selection-coord-hint-mark {
  stroke-width: 1.4;
}

/* 问号下面那一点是实心圆，不跟着走描边 */
.factory-selection-coord-hint-dot {
  fill: currentColor;
  stroke: none;
}

.factory-selection-group {
  flex-shrink: 0;
  font-size: 11px;
  color: #6f8ec0;
  font-variant-numeric: tabular-nums;
}

.factory-selection-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 4px;
}

.factory-selection-save {
  background: var(--accent);
  border: 1px solid var(--accent);
  color: #fff;
  cursor: pointer;
}

.factory-selection-save:disabled {
  background: var(--bg-slot);
  border-color: var(--line-strong);
  color: #6b7a95;
  cursor: default;
}

.factory-selection-empty {
  padding: 8px 2px;
  font-size: 14px;
  color: #8fa3c4;
}
</style>
