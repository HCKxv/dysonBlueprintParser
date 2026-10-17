<script setup lang="ts">
import { computed } from 'vue'
import ParamSlider from './ParamSlider.vue'
import {
  painting,
  currentMode,
  MAX_COLORS_STOPS,
  QUANTIZE_METHOD_OPTIONS,
  equatorMaxRepeats,
  EQUATOR_LAT_STOPS,
  EQUATOR_MAX_CROP,
  EQUATOR_MAX_CROP_POS,
  FOUNDATION_COLOR_COUNT,
  TILE_LAT_ROWS,
  planetGrid,
  foundationResult,
  isFoundationMode,
  type FillMode,
} from '../../stores/painting'
import { randomSeed } from '../../lib/painting/quantizeAlgorithms.js'

// 底色来源
const FILL_MODES: Array<{ value: FillMode; label: string; title?: string }> = [
  { value: 'black', label: '黑色' },
  { value: 'white', label: '白色' },
  { value: 'bg', label: '自动' },
  { value: 'none', label: '无' },
  { value: 'custom', label: '自定义' },
]

/** 图片缩放与移动只在半球投影下有效 */
const isHemisphere = computed(() => currentMode.value.kind === 'hemisphere')

/** 环带参数在赤道带的两档下都有效（戴森球的「环绕赤道」/ 地基的「平铺」） */
const isEquator = computed(() => currentMode.value.kind === 'equator')

// ── 裁剪（赤道带那档才有: 环绕赤道 / 平铺）──

/** 纬度范围滑块 */
const isTile = computed(() => painting.projMode === 'tile')

const rowLat = planetGrid.rowLat // 一行 = 一格高（度，0.36）
/** 地基的高度滑块: 界面按格，存的是角度 */
const tileHeight = computed({
  get: () => Math.round(painting.equatorLatFoundation / rowLat),
  set: (v: number) => {
    painting.equatorLatFoundation = Number((v * rowLat).toFixed(6))
  },
})

/** 地基彩绘的调色盘 */
const foundationPalette = computed(() => foundationResult.value?.palette ?? [])

/** 调色盘色块的 CSS 颜色 */
const rgbCss = (c: { r: number, g: number, b: number }) => `rgb(${c.r}, ${c.g}, ${c.b})`

/** 当前量化算法（含是否需要随机种子） */
const currentQuantizeMethod = computed(
  () => QUANTIZE_METHOD_OPTIONS.find((m) => m.value === painting.quantizeMethod) ?? QUANTIZE_METHOD_OPTIONS[0],
)

/** 手输种子（非数字忽略；负数归 0） */
function onSeedInput(e: Event) {
  const raw = Number((e.target as HTMLInputElement).value)
  if (!Number.isFinite(raw)) return
  painting.quantizeSeed = Math.max(0, Math.trunc(raw))
}

/** 换一个随机种子 */
function onRandomSeed() {
  painting.quantizeSeed = randomSeed()
}

/** 缩放滑块用百分比，存的是倍率 */
const zoomPercent = computed({
  get: () => Math.round(painting.imgZoom * 100),
  set: (v: number) => { painting.imgZoom = v / 100 },
})

// 两个移动滑块：数值就是百分比（0 = 不动），硬性只让滑到 ±80
const SHIFT_LIMIT = 80
const clampShift = (pct: number) => Math.max(-SHIFT_LIMIT, Math.min(SHIFT_LIMIT, Math.round(pct)))

const shiftXPct = computed({
  get: () => painting.imgShiftX,
  set: (v: number) => { painting.imgShiftX = clampShift(v) },
})
const shiftYPct = computed({
  get: () => painting.imgShiftY,
  set: (v: number) => { painting.imgShiftY = clampShift(v) },
})
</script>

<template>
  <div class="paint-projection">
    <!-- ── 投影位置（地基模式没有这个选项: 行星网格位置固定，经度偏移固定 0）── -->
    <div v-if="!isFoundationMode" class="paint-params-block">
      <div class="paint-params-head"><span>投影位置</span></div>

      <ParamSlider
        v-model="painting.hemiLng"
        :min="-180"
        :max="180"
        :step="1"
        unit="°"
      >
        <template #label>经度偏移</template>
      </ParamSlider>
    </div>

    <!-- ── 缩放与移动 ── -->
    <div v-if="isHemisphere" class="paint-params-block">
      <div class="paint-params-head"><span>缩放与移动</span></div>

      <ParamSlider v-model="zoomPercent" :min="50" :max="300" :step="5">
        <template #label>缩放</template>
      </ParamSlider>

      <ParamSlider v-model="shiftXPct" :min="-SHIFT_LIMIT" :max="SHIFT_LIMIT" :step="1">
        <template #label>水平移动</template>
      </ParamSlider>

      <ParamSlider v-model="shiftYPct" :min="-SHIFT_LIMIT" :max="SHIFT_LIMIT" :step="1">
        <template #label>垂直移动</template>
      </ParamSlider>
    </div>

    <!-- ── 环绕赤道 / 平铺 ── -->
    <div v-if="isEquator" class="paint-params-block">
      <div class="paint-params-head"><span>{{ isTile ? '高度与裁剪' : '环带与裁剪' }}</span></div>

      <!-- 平铺: 按格显示（40-180，步长 1 格，默认 80） -->
      <ParamSlider
        v-if="isTile"
        v-model="tileHeight"
        :min="TILE_LAT_ROWS.min"
        :max="TILE_LAT_ROWS.max"
        :step="TILE_LAT_ROWS.step"
      >
        <template #label>高度</template>
      </ParamSlider>
      <!-- 戴森球「环绕赤道」按度（30-72，默认 45） -->
      <ParamSlider
        v-else
        v-model="painting.equatorLatSphere"
        :min="EQUATOR_LAT_STOPS.min"
        :max="EQUATOR_LAT_STOPS.max"
        :step="EQUATOR_LAT_STOPS.step"
      >
        <template #label>纬度范围</template>
      </ParamSlider>

      <ParamSlider v-model="painting.equatorCropH" :min="0" :max="EQUATOR_MAX_CROP" :step="1">
        <template #label>水平裁剪</template>
      </ParamSlider>

      <ParamSlider
        v-model="painting.equatorCropHPos"
        :min="-EQUATOR_MAX_CROP_POS"
        :max="EQUATOR_MAX_CROP_POS"
        :step="5"
      >
        <template #label>水平裁剪位置</template>
      </ParamSlider>

      <ParamSlider v-model="painting.equatorCropV" :min="0" :max="EQUATOR_MAX_CROP" :step="1">
        <template #label>垂直裁剪</template>
      </ParamSlider>

      <ParamSlider
        v-model="painting.equatorCropVPos"
        :min="-EQUATOR_MAX_CROP_POS"
        :max="EQUATOR_MAX_CROP_POS"
        :step="5"
      >
        <template #label>垂直裁剪位置</template>
      </ParamSlider>

      <!-- 地基模式下这一档叫「平铺」: 按原比例铺一份，不重复 -->
      <ParamSlider
        v-if="!isFoundationMode"
        v-model="painting.equatorRepeats"
        :min="1"
        :max="equatorMaxRepeats"
        :step="1"
      >
        <template #label>重复次数</template>
      </ParamSlider>
    </div>

    <!-- ── 画面效果 ── -->
    <div class="paint-params-block">
      <div class="paint-params-head"><span>画面效果</span></div>

      <ParamSlider v-model="painting.brightness" :min="-100" :max="100" :step="5">
        <template #label>亮度</template>
      </ParamSlider>

      <ParamSlider v-model="painting.contrast" :min="-100" :max="100" :step="5">
        <template #label>对比度</template>
      </ParamSlider>

      <ParamSlider v-model="painting.saturation" :min="-100" :max="100" :step="5">
        <template #label>饱和度</template>
      </ParamSlider>

      <ParamSlider v-model="painting.sharpness" :min="0" :max="100" :step="5">
        <template #label>锐度</template>
      </ParamSlider>
    </div>

    <!-- ── 颜色 ── -->
    <div class="paint-params-block">
      <div class="paint-params-head"><span>颜色</span></div>

      <div class="paint-param">
        <div class="paint-param-label">采样</div>
        <select class="speed-select paint-select" v-model="painting.resample">
          <option value="average">区域平均</option>
          <option value="nearest">最近邻</option>
        </select>
      </div>

      <ParamSlider v-if="!isFoundationMode" v-model="painting.maxColors" :stops="MAX_COLORS_STOPS" unit="色">
        <template #label>颜色数量</template>
      </ParamSlider>

      <!-- 量化算法（中位切分 / 均值聚类）: 只有地基可选，戴森球固定中位切分 -->
      <div v-if="isFoundationMode" class="paint-param">
        <div class="paint-param-label">量化算法</div>
        <select class="speed-select paint-select" v-model="painting.quantizeMethod">
          <option v-for="m in QUANTIZE_METHOD_OPTIONS" :key="m.value" :value="m.value">
            {{ m.label }}
          </option>
        </select>
      </div>

      <!-- 随机种子: 紧跟量化算法（只有均值聚类用得上）—— 同一个种子给出同一份调色板 -->
      <div v-if="isFoundationMode && currentQuantizeMethod.needsSeed" class="paint-param">
        <div class="paint-param-label">随机种子</div>
        <div class="btn-group paint-seed-row">
          <input
            class="input-dark paint-num"
            type="number"
            min="0"
            step="1"
            :value="painting.quantizeSeed"
            @change="onSeedInput"
          />
          <button class="btn-sm btn-ghost" type="button" @click="onRandomSeed">随机</button>
        </div>
      </div>

      <!-- 地基: 颜色数量固定 16 色（每格 5 位色号），直接把调色盘摆出来 -->
      <div v-if="isFoundationMode" class="paint-param">
        <div class="paint-param-head">
          <span class="paint-param-label">调色盘</span>
          <span class="paint-param-value mono">{{ foundationPalette.length }} 色</span>
        </div>
        <div v-if="foundationPalette.length" class="paint-palette">
          <span
            v-for="(c, i) in foundationPalette"
            :key="i"
            class="paint-swatch"
            :style="{ background: rgbCss(c) }"
            :title="`自定义色 ${FOUNDATION_COLOR_COUNT + i} · rgb(${c.r}, ${c.g}, ${c.b})`"
          ></span>
        </div>
        <div v-else class="paint-palette-empty">生成彩绘后显示</div>
      </div>

      <!-- 地基模式没有「图外填充」: 图外就是「不铺地基」，不开放填色 -->
      <div v-if="!isFoundationMode" class="paint-param">
        <div class="paint-param-label">图外填充</div>
        <div class="btn-group paint-preset-row">
          <template v-for="m in FILL_MODES" :key="m.value">
            <span
              v-if="m.value === 'custom'"
              class="paint-custom-group"
              :class="{ boxed: painting.fillMode === m.value }"
            >
              <button
                type="button"
                class="btn-sm"
                :class="{ 'btn-ghost': painting.fillMode !== m.value }"
                @click="painting.fillMode = m.value"
              >{{ m.label }}</button>
              <input
                v-if="painting.fillMode === m.value"
                class="paint-color"
                type="color"
                v-model="painting.fillColor"
              />
            </span>
            <button
              v-else
              type="button"
              class="btn-sm"
              :class="{ 'btn-ghost': painting.fillMode !== m.value }"
              :title="m.title"
              @click="painting.fillMode = m.value"
            >{{ m.label }}</button>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.paint-select {
  width: 100%;
  padding: 3px 4px;
}

.paint-seed-row {
  margin-left: 0;
  gap: 4px;
  align-items: center;
}

.paint-seed-row .paint-num {
  width: 110px;
}

.paint-palette {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 2px;
}

.paint-swatch {
  width: 18px;
  height: 18px;
  border-radius: 4px;
  border: 1px solid #2d3c56;
}

.paint-palette-empty {
  font-size: 11px;
  color: var(--fg-muted);
  margin-top: 2px;
}

/* 「自定义」按钮 + 取色器: 选中时用外框圈成同一个控件 */
.paint-custom-group {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.paint-custom-group.boxed {
  padding: 1px 3px 1px 1px;
  border: 1px solid var(--line-strong);
  border-radius: 9px;
  background: #131c2d;
  align-items: stretch;   /* 取色器拉伸到按钮高度 */
}

.paint-custom-group.boxed .btn-sm {
  border-radius: 7px;
}

.paint-custom-group.boxed .paint-color {
  width: 58px;
  height: auto;
  border-radius: 7px;
}

.paint-color {
  width: 36px;
  height: 20px;
  padding: 0;
  border: 1px solid var(--line-soft);
  border-radius: 5px;
  background: var(--bg-input);
  cursor: pointer;
}

/* 色块填满取色器（Chrome 默认在 swatch 外留内边距） */
.paint-color::-webkit-color-swatch-wrapper {
  padding: 0;
}

.paint-color::-webkit-color-swatch {
  border: none;
  border-radius: 4px;
}

/* 图外填充那一排: 按钮换行排列 */
.paint-preset-row {
  margin-left: 0;
  gap: 4px;
  flex-wrap: wrap;
}
</style>
