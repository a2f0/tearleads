import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import packageJson from './package.json';

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version)
  },
  plugins: [react(), tailwindcss()],
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
