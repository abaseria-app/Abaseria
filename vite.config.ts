/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// On GitHub Pages the app lives at /<repo-name>/. Set BASE_PATH in the deploy workflow.
const base = process.env.BASE_PATH ?? '/';

export default defineConfig(({ mode }) => {
  // The dev build is served at /<repo>/dev/ next to the live app, on the same web address.
  const live = mode === 'production';
  return {
    base,
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icons/*.png'],
        manifest: {
          name: live ? 'Abeseria' : 'Abeseria Dev',
          short_name: live ? 'Abeseria' : 'Abeseria Dev',
          description: 'Grocery tally: snap the shelf tag, watch your total.',
          theme_color: '#1a3555',
          background_color: '#ffffff',
          display: 'standalone',
          orientation: 'portrait',
          start_url: base,
          scope: base,
          icons: [
            { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          // OCR engine + language data are large; precache them so the app works in a basement with no signal.
          globPatterns: ['**/*.{js,css,html,png,svg,gz,mp4}'],
          // Modern Android Chrome uses the relaxed-SIMD core, so only that one is precached (about 4 MB).
          // Older phones fetch their core on first use and keep it via the runtime cache below.
          globIgnores: ['**/tesseract-core-lstm.wasm.js', '**/tesseract-core-simd-lstm.wasm.js'],
          maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
          // The live app's offline cache must not answer for the dev app's pages.
          navigateFallbackDenylist: live ? [new RegExp(`^${base}dev/`)] : [],
          runtimeCaching: [
            {
              urlPattern: /\/tesseract\/.*\.js$/,
              handler: 'CacheFirst',
              options: { cacheName: live ? 'ocr-core' : 'ocr-core-dev', expiration: { maxEntries: 6 } },
            },
          ],
        },
      }),
    ],
    test: {
      include: ['src/**/*.test.ts'],
    },
  };
});
