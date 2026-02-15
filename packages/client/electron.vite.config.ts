import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import {defineConfig} from 'electron-vite';
import {VitePWA} from 'vite-plugin-pwa';
import packageJson from './package.json';
import {pwaOptions} from './pwa.options';
import {createViteAliases} from './vite.aliases';
import {createAppConfigPlugin} from './vite-plugin-app-config';

// Initialize app config plugin for virtual module and disabled package support
const {plugin: appConfigPlugin, disabledPackages} = createAppConfigPlugin(__dirname);

export default defineConfig({
  main: {
    define: {
      __APP_VERSION__: JSON.stringify(packageJson.version),
    },
    build: {
      lib: {
        entry: 'electron/main.ts',
      },
      rollupOptions: {
        external: ['better-sqlite3-multiple-ciphers'],
      },
    },
  },
  preload: {
    build: {
      lib: {
        entry: 'electron/preload.ts',
        formats: ['cjs'],
      },
      rollupOptions: {
        output: {
          entryFileNames: '[name].js',
        },
      },
    },
  },
  renderer: {
    root: '.',
    define: {
      __APP_VERSION__: JSON.stringify(packageJson.version),
    },
    build: {
      outDir: 'out/renderer',
      rollupOptions: {
        input: './index.html',
      },
    },
    worker: {
      format: 'es',
    },
    resolve: {
      alias: createViteAliases(__dirname, {disabledPackages}),
    },
    plugins: [appConfigPlugin, react(), tailwindcss(), VitePWA(pwaOptions)],
  },
});
