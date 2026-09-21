<script setup lang="ts">
import { computed, reactive, ref, toRaw, watch } from 'vue'
import BaseModal from '../BaseModal.vue'
import { store } from '../../stores/preview'
import { copyShell } from '../../lib/blueprint/sphere/blueprintEdit.js'
import { stringifyBlueprint } from '../../lib/blueprint/sphere/blueprintEncoder.js'
import { computePower, fmtKW } from '../../lib/power/power.js'
import { computePointsAsync, cancelPowerComputes } from '../../lib/power/powerAsync.js'
import { downloadTxt } from '../../utils/download'
import { useToast } from '../../composables/useToast'

const toast = useToast()

const busy = ref(false)
const computing = ref(false)
const previewPowerText = ref('')

const form = reactive({
  radius: 10000,
  ascendingNode: 0,
  inclination: 0,
  count: 2,
  step: 1000,
  direction: -1,
  luminosity: 1.0,
  autoOrbitCloud: false,
})

watch(
  () => store.showCopyShellModal,
  (open) => {
    if (!open) return
    busy.value = false
    computing.value = false
    previewPowerText.value = ''
    form.radius = 10000
    form.ascendingNode = 0
    form.inclination = 0
    form.count = 2
    form.step = 1000
    form.direction = -1
    form.luminosity = store.luminosity
    form.autoOrbitCloud = false
  },
)

const minLayerRadius = computed(() => {
  const n = Math.max(0, Math.floor(form.count) || 1) - 1
  return Math.round((form.radius || 0) + form.direction * (form.step || 0) * n)
})

const invalidText = computed(() => {
  if (!Number.isFinite(form.radius) || form.radius > 300000 || form.radius < 4000) return '半径必须在 4000 到 300000 之间';
  if (!Number.isFinite(form.step) || form.step < 1000) return '步长不能小于 1000'
  if (!Number.isFinite(form.count) || form.count < 1 || form.count > 10) return '复制次数需为 1-10'
  if (!Number.isFinite(form.inclination) || form.inclination < 0 || form.inclination > 180) return '轨道倾角需在 0-180 之间'
  if (!Number.isFinite(form.ascendingNode) || form.ascendingNode < 0 || form.ascendingNode > 360) return '交升点经度需在 0-360 之间'
  if (minLayerRadius.value < 4000) return `最小层半径 ${minLayerRadius.value} 低于 4000`
  return ''
})

async function confirm() {
  if (busy.value || invalidText.value) return
  busy.value = true

  const parsed = store.parsed
  if (invalidText.value || !parsed || parsed.body?.typeId !== 1) {
    toast.show('没有已解析的蓝图或不是单层壳蓝图')
  }

  try{
    const multi = await copyShell(toRaw(parsed), { ...form })
    const text = await stringifyBlueprint(multi)
    downloadTxt(text, `${form.count}层戴森${form.autoOrbitCloud?'球':'壳'}`)
    await navigator.clipboard.writeText(text)
    store.showCopyShellModal = false
    toast.show(`已生成 ${form.count} 层戴森壳，并复制到剪贴板`)
  } catch (error) {
    toast.show(`提取壳层失败：\n${(error as Error).message}`)
  }

  busy.value = false
}

/** 发电量预览: 生成多层壳 + 在 Worker 里算点数（算的时候按钮置灰） */
async function previewPower() {
  const parsed = store.parsed
  if (computing.value || invalidText.value || !parsed || parsed.body?.typeId !== 1) return
  computing.value = true
  try {
    const multi = await copyShell(toRaw(parsed), { ...form })
    const points = await computePointsAsync(multi.body, null, { key: 'copy-shell' })
    const lum = Math.min(10, Math.max(0.1, form.luminosity || 1.0))
    previewPowerText.value = points
      ? fmtKW(computePower(points, lum))
      : '0 W'
  } catch (error) {
    if ((error as Error).name === 'AbortError') return
    previewPowerText.value = '计算失败'
  } finally {
    computing.value = false
  }
}

function closeModal() {
  if (busy.value) return
  cancelPowerComputes('copy-shell')   // 放弃还在算的发电量预览
  store.showCopyShellModal = false
}
</script>

<template>
  <BaseModal :open="store.showCopyShellModal" title="将单层蓝图复制为多层" @close="closeModal">
    <div class="menu-div">

      <div class="menu"><span>复制参数：</span></div>
      <form novalidate><div class="menu">
        <span>初始半径</span>
        <input
          v-model.number="form.radius"
          type="number"
          step="1000"
          min="4000"
          max="300000"
          class="input-dark w-80"
        />
        <span>复制次数</span>
        <input
          v-model.number="form.count"
          type="number"
          step="1"
          min="1"
          max="10"
          class="input-dark w-70"
        />
        <span>步长</span>
        <input
          v-model.number="form.step"
          type="number"
          step="100"
          min="1000"
          class="input-dark w-70"
        />
        <select v-model.number="form.direction" class="speed-select" style="padding: 3px 4px;">
          <option :value="1">递增</option>
          <option :value="-1">递减</option>
        </select>
      </div></form>

      <div class="menu">
        <span>交升点经度</span>
        <input
          v-model.number="form.ascendingNode"
          type="number"
          min="0"
          max="360"
          class="input-dark w-70"
        />
        <span>轨道倾角</span>
        <input
          v-model.number="form.inclination"
          type="number"
          min="0"
          max="180"
          class="input-dark w-70"
        />
      </div>

      <div class="menu">
        <label>
          <input type="checkbox" v-model="form.autoOrbitCloud" />
          添加适用于自动轨道弹射的戴森云
        </label>
      </div>

      <div v-if="invalidText" class="menu" style="color: #ff6b6b;">
        ⚠ {{ invalidText }}
      </div>

      <hr class="menu-divider" />

      <div class="menu">
        <span>光度</span>
        <form novalidate><input
          v-model.number="form.luminosity"
          type="number"
          step="0.1"
          min="0.1"
          class="input-dark w-70"
        /></form>
        <button class="btn-sm" :disabled="busy || computing || !!invalidText" @click="previewPower">
          {{ computing ? '计算中...' : '计算发电量' }}
        </button>
        <span v-if="previewPowerText">⚡ {{ previewPowerText }}</span>
      </div>

      <hr class="menu-divider" />

      <span class="btn-group center">
        <button class="btn-sm" :disabled="busy || !!invalidText" @click="confirm">
          {{ busy ? '生成中...' : '确认' }}
        </button>
        <button class="btn-sm" :disabled="busy" @click="closeModal">取消</button>
      </span>
    </div>
  </BaseModal>
</template>
