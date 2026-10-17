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
        name: '戴森球计划蓝图工具',
        short_name: '蓝图工具',
        description: '《戴森球计划》的蓝图工具，支持蓝图预览、编辑、发电量计算。',
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
        runtimeCaching: [
          {
            urlPattern: /\/assets\/.*\.png$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'assets-png',
              expiration: { maxEntries: 600, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
      // 开发服务器不启用 PWA
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
    assetsInlineLimit: 0,
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
