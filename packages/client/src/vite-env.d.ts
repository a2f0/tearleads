/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/**
 * Virtual module declaration for app configuration.
 * Provided by vite-plugin-app-config based on APP environment variable.
 */
declare module 'virtual:app-config' {
  import type {
    AppFeature,
    AppPlatform,
    AppTheme
  } from '../../app-builder/src/types.js';

  interface AppConfig {
    id: string;
    displayName: string;
    features: AppFeature[];
    platforms: AppPlatform[];
    theme: AppTheme;
    api: {
      productionUrl: string;
      stagingUrl?: string;
    };
  }

  const config: AppConfig;
  export default config;
}
