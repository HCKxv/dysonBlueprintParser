import { ITEM_MODEL } from './buildingModels.js';
import { isBelt, isInserter, isLab, isStation } from '../blueprint/factory/factoryItems.js';

/**
 * 替换配方
 * @param {object} blueprint 
 * @param {{ from: number, to: number, acceleratorMode: 0 | 1 | null }} options 
 */
function editRecipe(blueprint, options) {
  if (!blueprint?.buildings) return false;

  blueprint.buildings.forEach((building) => {
    if (!building) return;
    if (building.recipeId === options.from) {
      building.recipeId = options.to;
      if (options.acceleratorMode !== null && building.parameters) building.parameters.acceleratorMode = options.acceleratorMode
    }
  });
  return true;
};

/**
 * 升降级建筑
 * @param {object} blueprint 
 * @param {{ from: number, to: number }} options 
 */
function batchUp(blueprint, options) {
  if (!blueprint?.buildings) return false;

  blueprint.buildings.forEach((building) => {
    if (!building) return;

    if (building.itemId === options.from) {
      building.itemId = options.to;
      building.modelIndex = ITEM_MODEL[options.to]?.[0];
    }
  });
  return true;
};

/**
 * 修改物流塔物品
 * @param {object} blueprint 
 * @param {{ from: number, to: number }} options 
 */
function editStationItems(blueprint, options) {
  if (!blueprint?.buildings) return false;
  const stationID = [2103, 2104]
  
  blueprint.buildings.forEach((building) => {
    if (!building) return;

    if (stationID.includes(building.itemId)) {
      building.parameters.storage?.forEach((slot) => {
        if (slot.itemId === options.from) {
          slot.itemId = options.to;
        };
      });
    };

    if (isBelt(building.itemId) && stationID.includes(blueprint.buildings[building.inputObjIdx]?.itemId)) {
      if (building.parameters?.iconId === options.from){
        building.parameters.iconId = options.to;
      };
    };
  });
  return true;
};

/**
 * 将传送带的图标标签对齐连接的运输站
 *
 * @param {object} blueprint 蓝图对象
 */
function syncBeltIcon(blueprint) {
  if (!blueprint?.buildings) return false;

  blueprint.buildings.forEach((building) => {
    if (!building) return;

    if (isBelt(building.itemId)) {
      const station = blueprint.buildings[building.inputObjIdx];
      if (!isStation(station?.itemId)) return;
      const storageIdx = station.parameters.slots[building.inputFromSlot]?.storageIdx;
      
      let item = 0;
      if (storageIdx >= 1 && storageIdx <= 5) {
        const storage = station.parameters.storage[storageIdx - 1];
        item = storage?.itemId ?? 0;
      }
      else if (storageIdx == 6) item = 1210;

      building.parameters.iconId = item;
    };
  });
}

/**
 * 修改物品过滤
 * @param {object} blueprint 
 * @param {{ from: number, to: number, target: '全部'|'分拣器'|'四向'|'配送器' }} options 
 */
function editFilter(blueprint, options) {
  if (!blueprint?.buildings) return false;

  const isTarget = (i) => {
    const ins = isInserter(i)
    const spl = i === 2020
    const dlv = i === 2107

    switch(options.target){
      case '全部': return ins || spl || dlv;
      case '分拣器': return ins;
      case '四向': return spl;
      case '配送器': return dlv;
    }
  };

  blueprint.buildings.forEach((building) => {
    if (!building) return;

    if (isTarget(building.itemId) && building.filterId === options.from) {
      building.filterId = options.to;
    }
  });
  return true;
};

/** 批量编辑的规则类型表 */
const BATCH_RULE_TYPES = [
  {
    id: 'upgrade',
    label: '升降级建筑',
    options: () => ({ from: 0, to: 0 }),
    run: batchUp,
  },
  {
    id: 'recipe',
    label: '替换配方',
    options: () => ({ from: 0, to: 0, acceleratorMode: null }),
    run: editRecipe,
  },
  {
    id: 'stationItem',
    label: '修改物流塔物品',
    options: () => ({ from: 0, to: 0 }),
    run: editStationItems,
  },
  {
    id: 'filter',
    label: '修改物品过滤',
    options: () => ({ from: 0, to: 0, target: '分拣器' }),
    run: editFilter,
  },
];

/**
 * 把规则数组依次作用到蓝图上
 *
 * @param {object} blueprint 蓝图对象（factoryParser 的解析结果）
 * @param {Array<{ type: string, options: object }>} rules 规则数组
 */
function applyBatchRules(blueprint, rules) {
  if (!blueprint?.buildings || !Array.isArray(rules)) return;

  for (const rule of rules) {
    const type = BATCH_RULE_TYPES.find((item) => item.id === rule?.type);
    if (!type) continue;
    type.run(blueprint, rule.options ?? {});
  }
}

export { BATCH_RULE_TYPES, applyBatchRules, syncBeltIcon };
