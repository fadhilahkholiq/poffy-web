import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { FEATURE_PAGES } from './src/core/seo/features.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const mpaInputs = {
  main: path.resolve(__dirname, 'index.html'),
  ...Object.fromEntries(
    FEATURE_PAGES.map((f) => [f.slug, path.resolve(__dirname, f.slug, 'index.html')])
  )
};

export default defineConfig({
  plugins: [
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'script-defer',
      manifest: {
        name: 'Poffy — Offline PDF Studio',
        short_name: 'Poffy',
        description:
          '100% client-side, privacy-first, offline-capable PDF editor for merging, splitting, watermarking, scrubbing metadata, and converting PDFs.',
        lang: 'en',
        categories: ['productivity', 'utilities'],
        orientation: 'any',
        theme_color: '#fffaf0',
        background_color: '#fffaf0',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: '/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          },
          {
            src: '/icons/icon-192.svg',
            sizes: '192x192',
            type: 'image/svg+xml',
            purpose: 'any'
          },
          {
            src: '/icons/icon-512.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        // Atomic revision-hashed precache for all MPA HTML pages, JS, workers, WASM, CMaps, and fonts
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,wasm,ttf,woff,woff2,bcmap,properties}'],
        globIgnores: ['icons/og-card.png'],
        navigateFallback: null,
        maximumFileSizeToCacheInBytes: 15 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true
      }
    })
  ],
  worker: {
    format: 'es'
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 0,
    rollupOptions: {
      input: mpaInputs
    }
  }
});
