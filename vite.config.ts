import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// base 用相对路径，这样部署到 GitHub Pages 的任意仓库名下都能直接跑
export default defineConfig({
  base: './',
  server: {
    /**
     * 绑定双栈（IPv4 + IPv6）。
     *
     * 这不是可有可无的设置 —— Windows 上 `localhost` 会**优先解析到 IPv6 的 `::1`**，
     * 如果服务器只监听 IPv4 的 0.0.0.0，浏览器打开 http://localhost:5173 会直接连不上，
     * 而用 127.0.0.1 又一切正常。这个现象很容易让人以为是网站坏了。
     *
     * 绑到 `::` 会同时创建 `0.0.0.0` 和 `[::]` 两个监听，两种写法都能用。
     * 顺带的好处：手机在同一个 WiFi 下也能访问局域网地址。
     */
    host: '::',
    port: 5173,
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: '断舍离 · 物品整理',
        short_name: '断舍离',
        description: '整理你的物品，看清你的家当',
        lang: 'zh-CN',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        start_url: './',
        scope: './',
        icons: [
          { src: './icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: './icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: './icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
})
