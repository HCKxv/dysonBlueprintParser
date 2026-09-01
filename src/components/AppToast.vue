<script setup lang="ts">
import { useToast } from '../composables/useToast'

const { message, visible, transitionEnabled } = useToast()
</script>

<template>
  <div
    id="toast"
    :class="{ show: visible }"
    :style="{ transition: transitionEnabled ? '' : 'none' }"
  >{{ message }}</div>
</template>
