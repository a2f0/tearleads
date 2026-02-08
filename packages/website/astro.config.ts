import path from 'node:path';
import react from '@astrojs/react';
import { rehypeMermaid } from '@beoe/rehype-mermaid';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

export default defineConfig({
  integrations: [react()],
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'es', 'ua'],
    routing: {
      prefixDefaultLocale: false,
    },
  },
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: [
        {
          find: '@rapid/ui/styles.css',
          replacement: path.resolve(import.meta.dirname, '../ui/src/styles/index.css'),
        },
        {
          find: '@rapid/ui/theme.css',
          replacement: path.resolve(import.meta.dirname, '../ui/src/styles/theme.css'),
        },
        {
          find: '@rapid/ui/logo.svg',
          replacement: path.resolve(import.meta.dirname, '../ui/src/images/logo.svg'),
        },
        {
          find: /^@rapid\/ui$/,
          replacement: path.resolve(import.meta.dirname, '../ui/src/index.ts'),
        },
        {
          find: '@rapid/api/dist/openapi.json',
          replacement: path.resolve(import.meta.dirname, '../api/dist/openapi.json'),
        },
        {
          find: '@rapid/shared/licenses.json',
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
    rehypePlugins: [[rehypeMermaid, { class: 'not-prose' }]],
  },
});
