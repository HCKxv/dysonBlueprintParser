import { ref } from 'vue'

const message = ref('')
const visible = ref(false)
const transitionEnabled = ref(true)
let hideTimer: ReturnType<typeof setTimeout> | undefined

const consoleToastEnabled =
  import.meta.env.DEV

export function useToast() {
  function show(text: string, duration = 3000) {
    if (hideTimer) clearTimeout(hideTimer)

    if (consoleToastEnabled) {
      console.log(`[${new Date().toLocaleString()}] [toast]`, text);
    }

    message.value = text

    if (visible.value) {
      // 当前正在显示时，先禁用过渡瞬时隐藏，
      // 下一帧恢复过渡并重新显示，从而重播进入动画
      transitionEnabled.value = false
      visible.value = false
      requestAnimationFrame(() => {
        transitionEnabled.value = true
        visible.value = true
      })
    } else {
      visible.value = true
    }

    hideTimer = setTimeout(() => {
      visible.value = false
    }, duration)
  }

  return { message, visible, transitionEnabled, show }
}
