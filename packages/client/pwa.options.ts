import type {VitePWAOptions} from 'vite-plugin-pwa';

export const pwaOptions: Partial<VitePWAOptions> = {
  registerType: 'autoUpdate',
  manifest: {
    name: 'Tearleads',
    short_name: 'Tearleads',
    description: 'Tearleads mobile app',
    theme_color: '#ffffff',
    background_color: '#ffffff',
    display: 'standalone',
    start_url: '/',
    scope: '/',
    icons: [
      {
        src: '/generated/icon-192x192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/generated/icon-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  },
  workbox: {
    // Don't include html - navigation is handled by runtimeCaching with NetworkFirst
    globPatterns: ['**/*.{js,mjs,css,ico,png,svg,webmanifest}'],
    // Increase max file size for large JS bundles (e.g., web-llm library ~6MB)
    // Note: LLM models themselves are cached by web-llm at runtime, not by Workbox
    maximumFileSizeToCacheInBytes: 10 * 1024 * 1024, // 10MB
    // Clean up old caches when a new service worker is installed
    cleanupOutdatedCaches: true,
    // Activate new service worker immediately without waiting for tabs to close
    skipWaiting: true,
    // Take control of all clients immediately
    clientsClaim: true,
    // Don't use default navigateFallback - we handle it with runtimeCaching
    navigateFallback: null,
    runtimeCaching: [
      {
        // Static assets use CacheFirst - they're fingerprinted so safe to cache
        urlPattern: ({url}) =>
          url.origin === self.location.origin &&
          /\.(js|mjs|css|ico|png|svg|woff2?)$/.test(url.pathname),
        handler: 'CacheFirst',
        options: {
          cacheName: 'rapid8-static-cache',
          expiration: {
            maxEntries: 100,
            maxAgeSeconds: 60 * 60 * 24 * 7, // 7 days
          },
        },
      },
      {
        // Navigation requests use NetworkFirst - always try to get fresh HTML
        urlPattern: ({request}) => request.mode === 'navigate',
        handler: 'NetworkFirst',
        options: {
          cacheName: 'rapid8-html-cache',
          networkTimeoutSeconds: 3, // Wait max 3 seconds for network
          expiration: {
            maxEntries: 10,
            maxAgeSeconds: 0, // Expire immediately, but still available as fallback
          },
        },
      },
    ],
  },
};
