/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// On GitHub Pages the app lives at /<repo-name>/. Set BASE_PATH in the deploy workflow.
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png'],
      manifest: {
        name: 'Abeseria',
        short_name: 'Abeseria',
        description: 'Grocery tally: snap the shelf tag, watch your total.',
        theme_color: '#14532d',
        background_color: '#f6f5f0',
        display: 'standalone',
        orientation: 'portrait',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // OCR engine + language data are large; precache them so the app works in a basement with no signal.
        globPatterns: ['**/*.{js,css,html,png,svg,gz}'],
        // Modern Android Chrome uses the relaxed-SIMD core, so only that one is precached (about 4 MB).
        // Older phones fetch their core on first use and keep it via the runtime cache below.
        globIgnores: ['**/tesseract-core-lstm.wasm.js', '**/tesseract-core-simd-lstm.wasm.js'],
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /\/tesseract\/.*\.js$/,
            handler: 'CacheFirst',
            options: { cacheName: 'ocr-core', expiration: { maxEntries: 6 } },
          },
        ],
      },
    }),
  ],
  test: {
    include: ['src/**/*.test.ts'],
  },
});
