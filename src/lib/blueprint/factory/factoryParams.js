import { isBelt, isInserter, isAssembler, isLab, isTurret } from './factoryItems.js';

// ─────────────────────────────────────────────────────────────
// 参数值的显示名称
// ─────────────────────────────────────────────────────────────
// 传送带插槽接入方向
const SLOT_DIR_NAMES = { 0: '未接入', 1: '输出', 2: '输入' };
// 物流供需配置
const LOGISTIC_ROLE_NAMES = { 0: '仓储', 1: '供应', 2: '需求' };
// 物品上限锁定
const LOCK_AMOUNT_NAMES = { 0: '不锁定', 1: '锁定满仓', 2: '锁定半仓' };
// 储物仓类型
const STORAGE_TYPE_NAMES = { 0: '不过滤', 9: '存在过滤器' };

/**
 * 建筑参数编解码器
 *
 * 每个建筑（储物仓、物流运输站等）的 `parameters` 是一段 int32 数组，
 * 各字段以 int32（4 字节）为单位定位偏移。
 */

// 字段节点：定位一个 int32 参数，可选值域转换
class ParamNode {
  /**
   * @param {number|function} offset 参数偏移（int32 为单位；函数形式可动态计算）
   * @param {function|null} encode 编码转换（对象值 → 原始值）
   * @param {function|null} decode 解码转换（原始值 → 对象值）
   */
  constructor(offset, encode = null, decode = null) {
    this.offset = offset;
    this.encode = encode;
    this.decode = decode;
  }

  getOffset(words) {
    return typeof this.offset === 'function' ? this.offset(words) : this.offset;
  }

  set(words, value) {
    const off = this.getOffset(words);
    if (value === undefined || value === null) {
      words[off] = 0;
      return;
    }
    const v = this.encode ? this.encode(value, words) : value;
    words[off] = v === null || Number.isNaN(v) ? 0 : v;
  }

  get(words) {
    const off = this.getOffset(words);
    const raw = words[off];
    return this.decode ? this.decode(raw, words) : raw;
  }
}

/** 整型参数 */
function int(offset) {
  return new ParamNode(offset);
}

/**
 * 布尔参数
 * @param {number|function} offset 参数偏移
 * @param {number} trueValue true 对应的原始值（默认 1）
 * @param {number} falseValue false 对应的原始值（默认 -1）
 */
function bool(offset, trueValue = 1, falseValue = -1) {
  return new ParamNode(
    offset,
    (v) => (v === true ? trueValue : v === false ? falseValue : v),
    (raw) => raw === trueValue,
  );
}

/** 带单位换算的参数 */
function fun(offset, encode, decode) {
  return new ParamNode(offset, encode, decode);
}

// 数组节点：定长数组，元素模板可以是 (i) => 模板 的工厂函数
class ArrayNode {
  constructor(length, item) {
    this.length = length;
    this.item = item;
  }

  getItem(i) {
    return typeof this.item === 'function' ? this.item(i) : this.item;
  }
}

function arr(length, item) {
  return new ArrayNode(length, item);
}

// 按模板递归解码：模板为 { key: 节点/对象/数组 } 的树
function decodeTemplate(tpl, words) {
  if (tpl instanceof ParamNode) return tpl.get(words);
  if (tpl instanceof ArrayNode) {
    const out = [];
    for (let i = 0; i < tpl.length; i += 1) {
      out.push(decodeTemplate(tpl.getItem(i), words));
    }
    return out;
  }
  if (tpl && typeof tpl === 'object') {
    const out = {};
    for (const key of Object.keys(tpl)) {
      out[key] = decodeTemplate(tpl[key], words);
    }
    return out;
  }
  return tpl;
}

// 按模板递归编码。注意：模板遍历顺序即写入顺序，动态偏移字段须排在
// 其依赖的字段之后（如战场分析基站的 filters 依赖 storageType）。
function encodeTemplate(tpl, words, value) {
  if (tpl instanceof ParamNode) {
    tpl.set(words, value);
    return;
  }
  if (tpl instanceof ArrayNode) {
    for (let i = 0; i < tpl.length; i += 1) {
      encodeTemplate(tpl.getItem(i), words, value ? value[i] : undefined);
    }
    return;
  }
  if (tpl && typeof tpl === 'object') {
    for (const key of Object.keys(tpl)) {
      encodeTemplate(tpl[key], words, value ? value[key] : undefined);
    }
  }
}

// 编解码器：固定 int32 长度 + 字段模板
class ParamCodec {
  constructor(size, template) {
    this.size = size;
    this.template = template;
  }

  decode(words) {
    return decodeTemplate(this.template, words);
  }

  encode(params) {
    const words = new Int32Array(this.size);
    encodeTemplate(this.template, words, params);
    return words;
  }
}

function codec(size, template) {
  return new ParamCodec(size, template);
}

// ─────────────────────────────────────────────────────────────
// 原始参数 ↔ base64（小端字节序，与 edit-dspblue-print 的 JSON 表示一致）
// ─────────────────────────────────────────────────────────────
function int32ArrayToBase64(arr) {
  const u8 = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let binary = '';
  for (let i = 0; i < u8.length; i += 1) {
    binary += String.fromCharCode(u8[i]);
  }
  return btoa(binary);
}

function base64ToInt32Array(b64) {
  const binary = atob(b64);
  const u8 = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    u8[i] = binary.charCodeAt(i);
  }
  return new Int32Array(u8.buffer, 0, Math.floor(u8.byteLength / 4));
}

// 从参数对象还原原始 int32 数组（未知建筑/信标等需要原样往返的参数）
function paramsToWords(params) {
  if (params && typeof params._defaultParamsBase64 === 'string' && params._defaultParamsBase64) {
    return base64ToInt32Array(params._defaultParamsBase64);
  }
  if (params?._raw instanceof Int32Array) return params._raw;
  if (Array.isArray(params?._raw)) return Int32Array.from(params._raw);
  return new Int32Array(0);
}

// 默认编解码器：未匹配到专属编解码器的建筑，原样保留原始 int32 数组
const defaultCodec = {
  size: 0,
  decode(words) {
    return { _defaultParamsBase64: int32ArrayToBase64(words) };
  },
  encode(params) {
    return paramsToWords(params);
  },
};

// ─────────────────────────────────────────────────────────────
// 通用换算
// ─────────────────────────────────────────────────────────────
// 最大充能功率 MW → 原始值
function workEnergyPerTickEncode(v) { return Math.round(v * 50000 / 3); }
// 最大充能功率 原始值 → MW
function workEnergyPerTickDecode(v) { return Math.round(v / 5000 * 3) / 10; }

// ─────────────────────────────────────────────────────────────
// 各类建筑参数编解码器
// ─────────────────────────────────────────────────────────────
// 传送带 [2001, 2002, 2003]
const beltCodec = codec(2, {
  iconId: int(0), // 图标标签物品id
  count: int(1),  // 图标标签下的数字
});

// 分拣器 [2011, 2012, 2013, 2014]
const inserterCodec = codec(1, {
  length: int(0), // 分拣器长度 -> 1-3
});

// 四向分流器 [2020]
const splitterCodec = codec(6, {
  priority: arr(4, (i) => bool(i, 1, 0)), // 四个接口是否优先
});

// 制造厂类建筑
const assemblerCodec = codec(1, {
  acceleratorMode: int(0), // 增产效果 -> 0:额外产出 1:生产加速
});

// 研究站 [2901, 2902]
const labCodec = codec(2, {
  researchMode: int(0),    // 研究模式 -> 0:未选择 1:矩阵合成 2:科研模式
  acceleratorMode: int(1), // 增产效果
});

// 储物仓 [2101(30格), 2102(60格)]
function storageCodec(gridNum) {
  return codec(110, {
    bans: int(0),        // 限制不可自动放入的格子数
    storageType: int(1), // 储物仓类型 -> 0:不过滤 9:存在过滤器
    filters: arr(gridNum, (i) => int(10 + i)), // 物品过滤器
  });
}

// 储液罐 [2106]
const tankCodec = codec(2, {
  output: bool(0), // 是否输出
  input: bool(1),  // 是否输入
});

// 物流配送器 [2107]
const dispenserCodec = codec(128, {
  playerMode: int(0), // 机甲供需模式 -> 1:回收 2:供应和回收 3:供应
  storageMode: int(1), // 配送器间模式 -> 0:不勾选 1:供应 2:需求
  workEnergyPerTick: fun(2, workEnergyPerTickEncode, workEnergyPerTickDecode),
  courierAutoReplenish: bool(3, 1, 0), // 是否自动补充运输单位
});

// 运输站类 [2103, 2104, 2316]
function stationCodec(storageNum, slotsNum) {
  return codec(2048, {
    // 物品栏位参数（每栏 6 个 int32）
    storage: arr(storageNum, (i) => ({
      itemId: int(i * 6 + 0),       // 物品id
      localRole: int(i * 6 + 1),    // 本地供需 -> 0:仓储 1:供应 2:需求
      remoteRole: int(i * 6 + 2),   // 星际供需 -> 0:仓储 1:供应 2:需求
      max: int(i * 6 + 3),          // 物品上限
      lockAmount: int(i * 6 + 4),   // 锁定 -> 0:不锁定 1:锁定满仓 2:锁定半仓
    })),
    // 传送带插槽参数（偏移 192，每槽 4 个 int32）
    slots: arr(slotsNum, (i) => ({
      dir: int(192 + i * 4 + 0),    // 接入方向 -> 0:未接入 1:输出 2:输入
      storageIdx: int(192 + i * 4 + 1), // 对应物品栏索引 -> 0:不输出 1-5:物品栏 6:翘曲器
    })),
    // 主参数（偏移 320）
    workEnergyPerTick: fun(320, workEnergyPerTickEncode, workEnergyPerTickDecode),
    tripRangeOfDrones: fun(
      321,
      (v) => Math.round(Math.sin((90 - v) * Math.PI / 180) * 100000000),
      (v) => 90 - Math.round(Math.asin(v / 100000000) * 180 / Math.PI),
    ), // 运输机最远路程（度）-> 20-180
    tripRangeOfShips: fun(322, (v) => v * 24000, (v) => v / 24000), // 运输船最远路程
    includeOrbitCollector: bool(323), // 是否去轨道采集器取货
    warpEnableDistance: fun(324, (v) => v * 40000, (v) => v / 40000), // 曲速启用路程
    warperNecessary: bool(325),       // 是否翘曲器必备
    deliveryAmountOfDrones: int(326), // 运输机起送量（%）
    deliveryAmountOfShips: int(327),  // 运输船起送量（%）
    pilerCount: int(328),             // 输出货物集装数量
    miningSpeed: int(329),            // 开采速度
    droneAutoReplenish: bool(330, 1, 0), // 是否自动补充运输机
    shipAutoReplenish: bool(331, 1, 0),  // 是否自动补充运输船
  });
}

// 流速监测器 [2030]
const monitorCodec = codec(128, {
  targetBeltId: int(0),        // 绑定的传送带节点ID
  offset: int(1),
  targetCargoAmount: int(2),   // 目标流量（0.1个）
  periodTicksCount: int(3),    // 监测周期（秒）
  passOperator: int(4),        // 监测条件 -> 0:等于 1:不等于 2:>= 3:> 4:<= 5:<
  passColorId: int(5),         // 满足条件颜色索引
  failColorId: int(6),         // 不满足条件颜色索引
  tone: int(7),                // 声音警报-音色
  volume: int(8),              // 声音警报-音量
  pitch: int(9),               // 声音警报-音阶
  systemWarningMode: int(10),  // 系统警报模式
  repeat: bool(11, 1, 0),      // 声音警报-是否循环
  alarmMode: int(12),          // 声音警报模式
  length: fun(13, (v) => v * 10000, (v) => v / 10000), // 声音警报-时长
  cargoFilter: int(14),        // 货物过滤物品id
  systemWarningIconId: int(17), // 系统警报图标id
  falloffRadius: arr(2, (i) => fun(18 + i, (v) => v * 10, (v) => v / 10)), // 衰减距离
  spawnItemOperator: int(20),  // 生成/消耗货物模式 -> 0:不勾选 1:生成 2:消耗
});

// 射线接收站 [2208]
const rayReceiverCodec = codec(1, {
  productId: int(0), // 模式 -> 0:直接发电 1208:光子生成
});

// 能量枢纽 [2209]
const energyExchangerCodec = codec(1, {
  mode: int(0), // 模式 -> -1:放电 0:待机 1:充电
});

// 电磁轨道弹射器 [2311]
const ejectorCodec = codec(2, {
  orbitId: int(0),         // 送入轨道编号 -> 0:无 1-20:轨道编号
  tenfoldSpeed: bool(1, 1, 0), // 是否开启十倍射速
});

// 垂直发射井 [2312]
const siloCodec = codec(1, {
  tenfoldSpeed: bool(0, 1, 0),
});

// 战场分析基站 [3009]
// 过滤器仅在 storageType === 9 时占偏移量，其后的字段随动
const battleBaseCodec = (() => {
  const filtersOffset = (words) => (words[1] === 9 ? 60 : 0);
  const getPos = (n) => (words) => 10 + filtersOffset(words) + n;
  return codec(110, {
    bans: int(0),
    storageType: int(1),
    filters: arr(60, (i) => fun(10 + i, (v) => v, (raw, words) => (words[1] === 9 ? raw : 0))),
    workEnergyPerTick: fun(getPos(0), workEnergyPerTickEncode, workEnergyPerTickDecode),
    autoPickEnabled: bool(getPos(1), 1, 0),    // 是否自动拾取
    autoReplenishFleet: bool(getPos(2), 1, 0), // 是否自动补充编队
    moduleEnabled: bool(getPos(3), 1, 0),      // 是否开启战斗无人机
    autoReconstruct: bool(getPos(4), 1, 0),    // 是否自动标记重建
    droneEnabled: bool(getPos(5), 1, 0),       // 是否开启建设无人机
    dronesPriority: int(getPos(6)),            // 建设无人机模式 -> 0:优先修理 1:均衡 2:优先建造
    fighters: arr(12, (i) => int(getPos(7 + i))), // 战斗无人机编队
  });
})();

// 炮台类 [3001-3006, 3010]
const turretCodec = codec(128, {
  group: int(1), // 分组编号 -> 0:不分组 1-5:分组
  vsSettings: fun(
    2,
    (v) => (v ? (v[0] << 0) + (v[1] << 2) + (v[2] << 4) + (v[3] << 6) : 0),
    (v) => [v & 3, (v >> 2) & 3, (v >> 4) & 3, (v >> 6) & 3],
  ), // 攻击设置优先级 [地面, 低空, 高空, 太空] -> 0:关闭 1:低 2:均衡 3:高
  phasePos: fun(3, (v) => v * 60, (v) => v / 60), // 干扰塔相位偏移（秒）
});

// 全息信标 [2401]：固定 2048 int32，仅前 7 个字段已解析，其余原样保留
const MARKER_SIZE = 2048;
const markerCodec = {
  size: MARKER_SIZE,
  decode(words) {
    return {
      _defaultParamsBase64: int32ArrayToBase64(words),
      color: words[0] ?? 0,           // 颜色索引
      height: (words[1] ?? 0) / 100,  // 投影高度
      radius: (words[2] ?? 0) / 100,  // 投影半径
      visibility: words[3] ?? 0,      // 标记等级 -> 0:离线 1:视野内 2:本地星球 3:本地星系 4:全星区
      detailLevel: words[4] ?? 0,     // 信息等级 -> 0:不常显 1:常显图标 2:常显标题 3:常显待办
      icon: words[5] ?? 0,            // 图标ID
      digitalSignalId: words[6] ?? 0, // 信号传输IP
    };
  },
  encode(params) {
    const words = new Int32Array(MARKER_SIZE);
    const raw = paramsToWords(params);
    if (raw.length > 0) {
      words.set(raw.subarray(0, MARKER_SIZE));
    }
    if (params) {
      words[0] = params.color ?? 0;
      words[1] = Math.round((params.height ?? 0) * 100);
      words[2] = Math.round((params.radius ?? 0) * 100);
      words[3] = params.visibility ?? 0;
      words[4] = params.detailLevel ?? 0;
      words[5] = params.icon ?? 0;
      words[6] = params.digitalSignalId ?? 0;
    }
    return words;
  },
};

// 各建筑 id 的专属编解码器
const PARAM_CODECS = new Map([
  [2103, stationCodec(4, 12)],  // 行星内物流运输站
  [2104, stationCodec(5, 12)],  // 星际物流运输站
  [2316, stationCodec(1, 9)],   // 大型采矿机
  [2101, storageCodec(30)],     // 小型储物仓
  [2102, storageCodec(60)],     // 大型储物仓
  [3009, battleBaseCodec],      // 战场分析基站
  [2020, splitterCodec],        // 四向分流器
  [2106, tankCodec],            // 储液罐
  [2311, ejectorCodec],         // 电磁轨道弹射器
  [2208, rayReceiverCodec],     // 射线接收站
  [2209, energyExchangerCodec], // 能量枢纽
  [2312, siloCodec],            // 垂直发射井
  [2030, monitorCodec],         // 流速监测器
  [2107, dispenserCodec],       // 物流配送器
  [2401, markerCodec],          // 全息信标
]);

/**
 * 获取建筑参数编解码器；无专属编解码器时返回默认编解码器
 * （原样保留原始 int32 数组，见 `_defaultParamsBase64` 约定）
 * @param {number} itemId 建筑id
 * @returns {{size: number, decode: Function, encode: Function}}
 */
function getParamCodec(itemId) {
  if (isBelt(itemId)) return beltCodec;
  if (isInserter(itemId)) return inserterCodec;
  if (isAssembler(itemId)) return assemblerCodec;
  if (isLab(itemId)) return labCodec;
  if (isTurret(itemId)) return turretCodec;
  return PARAM_CODECS.get(itemId) ?? defaultCodec;
}

export {
  ParamCodec,
  getParamCodec,
  int32ArrayToBase64,
  base64ToInt32Array,
  SLOT_DIR_NAMES,
  LOGISTIC_ROLE_NAMES,
  LOCK_AMOUNT_NAMES,
  STORAGE_TYPE_NAMES,
};
