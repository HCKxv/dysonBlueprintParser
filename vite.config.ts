import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'sphere.svg'],
      injectRegister: 'auto',
      manifest: {
        name: '戴森球蓝图预览 & 发电量计算',
        short_name: '戴森球预览',
        description: '戴森球蓝图预览、发电量计算与离线查看工具',
        theme_color: '#0b1020',
        background_color: '#0b1020',
        display: 'standalone',
        start_url: './',
        scope: './',
        orientation: 'any',
        icons: [
          {
            src: 'sphere.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,svg,json}'],
      },
      // 开发服务器不启用 PWA
      // 需要单独调试 dev 下的 SW 时，把 enabled 临时改回 true
      devOptions: {
        enabled: false,
      },
    }),
  ],
  base: './',
  worker: {
    format: 'es',
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/')) {
            if (id.includes('/three/')) return 'three'
            if (id.includes('/vue/') || id.includes('/@vue/')) return 'vue'
          }
        },
      },
    },
  },
})
