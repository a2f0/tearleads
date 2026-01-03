import path from 'node:path';
import react from '@astrojs/react';
import { rehypeMermaid } from '@beoe/rehype-mermaid';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

export default defineConfig({
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        '@docs': path.resolve(import.meta.dirname, '../../docs'),
        '@rapid/ui/logo.svg': path.resolve(
          import.meta.dirname,
          '../ui/src/images/logo.svg'
        ),
      },
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
