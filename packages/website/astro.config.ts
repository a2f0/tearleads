import path from 'node:path';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

export default defineConfig({
  devToolbar: {
    enabled: false,
  },
  integrations: [react()],
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'es', 'ua', 'pt'],
    routing: {
      prefixDefaultLocale: false,
    },
  },
  vite: {
    plugins: [tailwindcss()],
    ssr: {
      // Bundle router packages in SSR so Vite evaluates them as ESM.
      noExternal: ['react-router-dom', 'react-router'],
      // Ensure SSR resolution also selects react-router's ESM condition.
      resolve: {
        conditions: ['module-sync'],
      },
    },
    resolve: {
      // Prefer react-router's ESM export condition over the Node CJS fallback.
      conditions: ['module-sync'],
      alias: [
        {
          find: '@tearleads/ui/styles.css',
          replacement: path.resolve(import.meta.dirname, '../ui/src/styles/index.css'),
        },
        {
          find: '@tearleads/ui/theme.css',
          replacement: path.resolve(import.meta.dirname, '../ui/src/styles/theme.css'),
        },
        {
          find: /^@tearleads\/ui\/logo\.svg(\?.*)?$/,
          replacement: path.resolve(import.meta.dirname, '../ui/src/images/logo.svg'),
        },
        {
          find: /^@tearleads\/ui$/,
          replacement: path.resolve(import.meta.dirname, '../ui/src/index.ts'),
        },
        {
          find: '@tearleads/api/dist/openapi.json',
          replacement: path.resolve(import.meta.dirname, '../api/dist/openapi.json'),
        },
        {
          find: '@tearleads/shared/licenses.json',
          replacement: path.resolve(import.meta.dirname, '../shared/dist/licenses.json'),
        },
      ],
    },
    server: {
      strictPort: true,
    },
  },
  server: {
    port: 3001,
  },
  markdown: {
    syntaxHighlight: {
      type: 'shiki',
      excludeLangs: ['mermaid'],
    },
  },
});
