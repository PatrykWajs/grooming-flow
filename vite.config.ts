import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// The app is bound to its origin and path: `BASE_PATH=/grooming-flow/` on the
// interim project page, `/` once the repo lives at groomingflow.github.io.
const base = process.env.BASE_PATH ?? '/'

export default defineConfig({
  base,
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png', 'icons/*.svg'],
      manifest: {
        id: `${base}app/`,
        name: 'Grooming Flow',
        short_name: 'Grooming Flow',
        description: 'Your wardrobe, one outfit a day.',
        start_url: `${base}app/`,
        scope: base,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#F4F0E8',
        theme_color: '#F4F0E8',
        lang: 'el',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,json,svg,png,webp}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: null,
        // Models (Hugging Face Hub) are cached by Transformers.js itself; the
        // forecast is cached in IndexedDB by the weather provider.
        runtimeCaching: [],
      },
    }),
  ],
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        landing: fileURLToPath(new URL('./index.html', import.meta.url)),
        app: fileURLToPath(new URL('./app/index.html', import.meta.url)),
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    passWithNoTests: true,
  },
})
