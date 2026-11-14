import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const base = process.env.PAGES_BASE_PATH ?? '/';
if (!base.startsWith('/') || !base.endsWith('/')) {
  throw new Error('PAGES_BASE_PATH deve iniziare e terminare con "/".');
}

export default defineConfig({
  base,
  define: {
    __BUILD_ID__: JSON.stringify(process.env.BUILD_ID?.slice(0, 8) ?? new Date().toISOString()),
  },
  plugins: [
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['apple-touch-icon.png'],
      manifest: {
        id: './',
        name: 'Ore veterinarie',
        short_name: 'Ore vet',
        description: 'Registra le ore lavorate e consulta i compensi maturati.',
        lang: 'it',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#f4f7f5',
        theme_color: '#185c49',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'],
        cleanupOutdatedCaches: true,
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
});
