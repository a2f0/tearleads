import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import packageJson from './package.json';

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version)
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
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
            type: 'image/png'
          },
          {
            src: '/generated/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: '/generated/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}']
      }
    })
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Alias UI package to source for HMR
      '@rapid/ui/styles.css': path.resolve(__dirname, '../ui/src/styles/index.css'),
      '@rapid/ui/theme.css': path.resolve(__dirname, '../ui/src/styles/theme.css'),
      '@rapid/ui/logo.svg': path.resolve(__dirname, '../ui/src/images/logo.svg'),
      '@rapid/ui': path.resolve(__dirname, '../ui/src/index.ts')
    }
  },
  clearScreen: false,
  server: {
    port: 3000
  }
});
