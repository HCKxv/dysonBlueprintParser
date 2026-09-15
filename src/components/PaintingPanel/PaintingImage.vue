<script setup lang="ts">
import { computed } from 'vue'
import ParamSlider from './ParamSlider.vue'
import {
  painting,
  PROJ_MODES,
  MAX_COLORS_STOPS,
  equatorMaxRepeats,
  type FillMode,
} from '../../stores/painting'

// 填充色来源
const FILL_MODES: Array<{ value: FillMode; label: string }> = [
  { value: 'black', label: '黑色' },
  { value: 'white', label: '白色' },
  { value: 'bg', label: '自动' },
  { value: 'custom', label: '自定义' },
]

/** 图片调整只在半球投影下有效 */
const isHemisphere = computed(() => painting.projMode === 'hemisphere')

/** 环绕赤道参数只在环绕赤道模式下有效 */
const isEquator = computed(() => painting.projMode === 'equator')

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
    <!-- ── 投影模式 ── -->
    <div class="paint-params-block">
      <div class="paint-params-head"><span>投影模式</span></div>
      <div class="mode-grid">
        <button
          v-for="m in PROJ_MODES"
          :key="m.value"
          type="button"
          class="mode-card"
          :class="{ active: painting.projMode === m.value }"
          @click="painting.projMode = m.value"
        >
          <span class="mode-icon" v-html="m.icon"></span>
          <span class="mode-label">{{ m.label }}</span>
          <span class="mode-desc">{{ m.desc }}</span>
        </button>
      </div>

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

      <ParamSlider v-model="shiftXPct" :min="-80" :max="80" :step="1">
        <template #label>水平移动</template>
      </ParamSlider>

      <ParamSlider v-model="shiftYPct" :min="-80" :max="80" :step="1">
        <template #label>垂直移动</template>
      </ParamSlider>
    </div>

    <!-- ── 环绕赤道 ── -->
    <div v-if="isEquator" class="paint-params-block">
      <div class="paint-params-head"><span>环绕参数</span></div>

      <ParamSlider v-model="painting.equatorLat" :min="30" :max="72" :step="1.5">
        <template #label>纬度范围</template>
      </ParamSlider>

      <ParamSlider
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

      <ParamSlider v-model="painting.maxColors" :stops="MAX_COLORS_STOPS" unit="色">
        <template #label>颜色数量</template>
      </ParamSlider>

      <div class="paint-param">
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
              @click="painting.fillMode = m.value"
            >{{ m.label }}</button>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>
