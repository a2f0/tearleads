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
        src: '/favicon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
      },
    ],
  },
  workbox: {
    // Precache only the critical app shell; route chunks are cached on-demand.
    globPatterns: [
      'assets/index-*.{js,css}',
      'assets/vendor-react-*.js',
      'assets/vendor-ui-*.js',
      '*.webmanifest',
      'favicon.svg',
    ],
    globIgnores: ['**/sw.js', '**/workbox-*.js'],
    // Vite output filenames are content-hashed, so cache busting is unnecessary.
    dontCacheBustURLsMatching: /\.[a-f0-9]{8}\./,
    // Increase max file size for large JS bundles (e.g., web-llm library ~6MB)
    // and renderer entry chunks that can exceed 10MB in release builds.
    // Note: LLM models themselves are cached by web-llm at runtime, not by Workbox
    maximumFileSizeToCacheInBytes: 12 * 1024 * 1024, // 12MB
    // Clean up old caches when a new service worker is installed
    cleanupOutdatedCaches: true,
    // Activate new service worker immediately without waiting for tabs to close
    skipWaiting: true,
    // Take control of all clients immediately
    clientsClaim: true,
    // Speed up navigation by racing SW startup with network requests.
    navigationPreload: true,
    // Don't use default navigateFallback - we handle it with runtimeCaching
    navigateFallback: null,
    runtimeCaching: [
      {
        // Static assets use CacheFirst - they're fingerprinted so safe to cache.
        // Exclude .generated/ paths: WASM glue JS files are not content-hashed
        // and must not be intercepted by CacheFirst (causes module load failures).
        urlPattern: ({url}) =>
          url.origin === self.location.origin &&
          !url.pathname.startsWith('/.generated/') &&
          /\.(js|mjs|css|ico|png|svg|woff2?)$/.test(url.pathname),
        handler: 'CacheFirst',
        options: {
          cacheName: 'tearleads8-static-cache',
          expiration: {
            maxEntries: 500,
            maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
          },
        },
      },
      {
        // Navigation requests use NetworkFirst - always try to get fresh HTML
        urlPattern: ({request}) => request.mode === 'navigate',
        handler: 'NetworkFirst',
        options: {
          cacheName: 'tearleads8-html-cache',
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
