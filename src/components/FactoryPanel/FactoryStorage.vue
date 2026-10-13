<script setup lang="ts">
/**
 * 储物仓（2101 / 2102）与储液罐（2106）的参数
 */
import { computed } from 'vue'
import { itemName } from '../../lib/blueprint/factory/factoryItems.js'
import { itemIconUrl } from '../../lib/markup/itemIcons'

const props = defineProps<{
  /** 建筑 id: 2101 小型储物仓 / 2102 大型储物仓 / 3009 战场分析基站 / 2106 储液罐 */
  type: number
  parameters: Record<string, any>
}>()

const isTank = computed(() => Number(props.type) === 2106)

/** 格子数: 2101 是 30，2102 与 3009 是 60 */
const gridNum = computed(() => (Number(props.type) === 2101 ? 30 : 60))

/** 受限格子的框色: 战场分析基站（3009）蓝框，储物仓红框 */
const bannedColor = computed(() => (Number(props.type) === 3009 ? 'var(--accent)' : 'var(--danger)'))

/** 是否启用了过滤: storageType 为 9（存在过滤器） */
const filterOn = computed(() => Number(props.parameters?.storageType) === 9)

/** 每个格子: item 是过滤物品（0 = 没设），banned = 自动化输入限制 */
const slots = computed(() => {
  const list = props.parameters?.filters
  const bans = Number(props.parameters?.bans ?? 0)
  const n = gridNum.value
  // filters 定长；长度对不上当作没有筛选数据
  const items = filterOn.value && Array.isArray(list) && list.length === n ? list : []
  return Array.from({ length: n }, (_, i) => ({
    item: Number(items[i] ?? 0),
    banned: i >= n - bans,
  }))
})
</script>

<template>
  <div class="factory-storage-info">
    <!-- 储物仓 / 战场分析基站 -->
    <div
      v-if="!isTank"
      class="factory-storage-grid"
      :style="{ '--factory-storage-banned': bannedColor }"
    >
      <span
        v-for="(slot, i) in slots"
        :key="i"
        class="factory-storage-slot"
        :class="{ 'factory-storage-slot-banned': slot.banned }"
      >
        <img v-if="slot.item > 0" class="factory-icon" :src="itemIconUrl(slot.item)" :alt="itemName(slot.item)" />
      </span>
    </div>

    <!-- 储液罐: 输入 / 输出 -->
    <template v-else>
      <div class="factory-storage-info-row">
        <span class="factory-storage-info-label">输出</span>
        <span class="factory-selection-value">{{ parameters?.output ? '开' : '关' }}</span>
      </div>
      <div class="factory-storage-info-row">
        <span class="factory-storage-info-label">输入</span>
        <span class="factory-selection-value">{{ parameters?.input ? '开' : '关' }}</span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.factory-storage-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* 每行 10 格（2101 → 3 行，2102 → 6 行） */
.factory-storage-grid {
  display: grid;
  grid-template-columns: repeat(10, 24px);
  gap: 3px;
}

.factory-storage-slot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  border: 1px solid var(--line-strong);
  background: var(--bg-slot);
}

/* 被 bans 限制的格子: 框色由 --factory-storage-banned 给（储物仓红 / 基站蓝） */
.factory-storage-slot-banned {
  border-color: var(--factory-storage-banned, var(--danger));
}

.factory-storage-slot .factory-icon {
  width: 80%;
  height: 80%;
}

.factory-storage-info-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
}

.factory-storage-info-label {
  flex-shrink: 0;
  color: #8fa3c8;
  white-space: nowrap;
}
</style>
