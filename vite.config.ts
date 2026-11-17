/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// On GitHub Pages the app lives at /<repo-name>/. Set BASE_PATH in the deploy workflow.
const base = process.env.BASE_PATH ?? '/';

export default defineConfig(({ mode }) => {
  // The dev build is served at /<repo>/dev/ next to the live app, on the same web address.
  const live = mode === 'production';
  // Home-screen icons: the dev app gets the logo with a DEV stamp so staff can tell the two apart.
  // The in-app logo (icons/icon-192.png on Login and Explore) stays the untouched logo in both.
  const icon = (name: string) => `icons/${live ? '' : 'dev-'}${name}`;
  return {
    base,
    plugins: [
      react(),
      {
        name: 'dev-home-screen-icons',
        transformIndexHtml: {
          order: 'pre',
          handler: (html) =>
            live
              ? html
              : html
                  .replace('href="/icons/icon-192.png"', 'href="/icons/dev-icon-192.png"')
                  .replace('href="/icons/apple-touch-icon.png"', 'href="/icons/dev-apple-touch-icon.png"'),
        },
      },
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: live ? ['icons/icon-*.png', 'icons/apple-touch-icon.png'] : ['icons/*.png'],
        manifest: {
          name: live ? 'Abaseria' : 'Abaseria Dev',
          short_name: live ? 'Abaseria' : 'Abaseria Dev',
          description: 'Grocery tally: snap the shelf tag, watch your total.',
          theme_color: '#1a3555',
          background_color: '#ffffff',
          display: 'standalone',
          orientation: 'portrait',
          start_url: base,
          scope: base,
          icons: [
            { src: icon('icon-192.png'), sizes: '192x192', type: 'image/png' },
            { src: icon('icon-512.png'), sizes: '512x512', type: 'image/png' },
            { src: icon('icon-maskable-512.png'), sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          // OCR engine + language data are large; precache them so the app works in a basement with no signal.
          globPatterns: ['**/*.{js,css,html,png,svg,gz,mp4,webp}'],
          // Modern Android Chrome uses the relaxed-SIMD core, so only that one is precached (about 4 MB).
          // Older phones fetch their core on first use and keep it via the runtime cache below.
          // The live app doesn't need the DEV-stamped icons in its offline cache.
          globIgnores: [
            '**/tesseract-core-lstm.wasm.js',
            '**/tesseract-core-simd-lstm.wasm.js',
            ...(live ? ['**/icons/dev-*'] : []),
          ],
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
