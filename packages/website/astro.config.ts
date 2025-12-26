import react from '@astrojs/react';
import { rehypeMermaid } from '@beoe/rehype-mermaid';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

export default defineConfig({
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
  },
  server: {
    port: 3001,
  },
  markdown: {
    rehypePlugins: [[rehypeMermaid, { class: 'not-prose' }]],
  },
});
