import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', '1.svg'],
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
            src: '1.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,svg,json}'],
      },
      devOptions: {
        enabled: true,
      },
    }),
  ],
  base: './',
})
