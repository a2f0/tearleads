/**
 * Vite plugin for app configuration.
 *
 * Loads app config from packages/app-builder/apps/{APP}/config.ts
 * based on the APP environment variable (defaults to 'tearleads').
 *
 * Provides:
 * - Virtual module 'virtual:app-config' for runtime access
 * - Disabled packages list for tree-shaking aliases
 *
 * Usage:
 *   APP=notepad pnpm dev
 *   APP=notepad pnpm build
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { Plugin } from 'vite';

const VIRTUAL_MODULE_ID = 'virtual:app-config';
const RESOLVED_VIRTUAL_MODULE_ID = '\0' + VIRTUAL_MODULE_ID;

// Inline jiti types to avoid adding a dev dependency
interface Jiti {
  (id: string): unknown;
}
interface JitiFactory {
  (parentUrl: string, options?: { interopDefault?: boolean }): Jiti;
}

/**
 * Minimal AppConfig type for the plugin.
 * Full type is in @tearleads/app-builder but we avoid the import
 * to prevent TypeScript cross-package reference issues.
 */
interface AppConfig {
  id: string;
  displayName: string;
  features: string[];
  platforms: string[];
  theme: {
    primaryColor: string;
    backgroundColor: string;
    accentColor: string;
  };
  api: {
    productionUrl: string;
    stagingUrl?: string;
  };
  monitoring?: {
    sentryDsn?: string;
    googleAnalyticsId?: string;
    posthogToken?: string;
  };
  translations?: Record<string, string>;
}

/**
 * Feature to packages mapping.
 * Kept in sync with @tearleads/app-builder/src/feature-map.ts
 */
const FEATURE_TO_PACKAGES: Record<string, string[]> = {
  admin: ['@tearleads/admin'],
  analytics: ['@tearleads/analytics'],
  audio: ['@tearleads/audio'],
  businesses: ['@tearleads/businesses'],
  calendar: ['@tearleads/calendar'],
  camera: ['@tearleads/camera'],
  classic: ['@tearleads/classic'],
  compliance: ['@tearleads/compliance'],
  contacts: ['@tearleads/contacts'],
  email: ['@tearleads/email'],
  health: ['@tearleads/health'],
  'mls-chat': ['@tearleads/mls-chat'],
  notes: ['@tearleads/notes'],
  sync: ['@tearleads/vfs-sync'],
  terminal: ['@tearleads/terminal'],
  vehicles: ['@tearleads/vehicles'],
  wallet: ['@tearleads/wallet']
};

/**
 * Get packages to disable based on enabled features.
 */
function getDisabledPackagesFromFeatures(enabledFeatures: string[]): string[] {
  const enabledSet = new Set(enabledFeatures);
  return Object.entries(FEATURE_TO_PACKAGES)
    .filter(([feature]) => !enabledSet.has(feature))
    .flatMap(([, packages]) => packages);
}

/**
 * Load app config synchronously at build time using jiti.
 */
function loadAppConfig(appId: string, dirname: string): AppConfig {
  const configPath = path.resolve(dirname, `../app-builder/apps/${appId}/config.ts`);

  if (!existsSync(configPath)) {
    throw new Error(
      `App config not found: ${configPath}\n` +
        `Available apps are in packages/app-builder/apps/\n` +
        `Set APP environment variable to a valid app ID.`
    );
  }

  // Use jiti for synchronous TypeScript loading (same as Vite uses internally)
  const require = createRequire(import.meta.url);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createJiti } = require('jiti') as { createJiti: JitiFactory };
  const jiti = createJiti(import.meta.url, { interopDefault: true });
  const configModule = jiti(configPath) as { default: AppConfig };
  return configModule.default;
}

interface AppConfigPluginOptions {
  /** Enable tree-shaking of disabled packages. Defaults to true in production. */
  enableTreeShaking?: boolean;
}

interface AppConfigPluginResult {
  plugin: Plugin;
  config: AppConfig;
  disabledPackages: string[];
}

/**
 * Create the app config Vite plugin.
 *
 * Returns the plugin along with config info for alias setup.
 */
export function createAppConfigPlugin(
  dirname: string,
  options: AppConfigPluginOptions = {}
): AppConfigPluginResult {
  const appId = process.env['APP'] || 'tearleads';
  const config = loadAppConfig(appId, dirname);
  const enableTreeShaking = options.enableTreeShaking ?? process.env['NODE_ENV'] === 'production';
  const disabledPackages = enableTreeShaking ? getDisabledPackagesFromFeatures(config.features) : [];

  // Runtime config to expose via virtual module
  const runtimeConfig = {
    id: config.id,
    displayName: config.displayName,
    features: config.features,
    platforms: config.platforms,
    theme: config.theme,
    api: config.api,
    monitoring: config.monitoring,
    translations: config.translations
  };

  // Stub module ID prefix for disabled packages
  const STUB_PREFIX = '\0disabled-package:';

  const plugin: Plugin = {
    name: 'app-config',

    resolveId(id) {
      if (id === VIRTUAL_MODULE_ID) {
        return RESOLVED_VIRTUAL_MODULE_ID;
      }
      // Check if this is a disabled package import
      const pkgName = disabledPackages.find(
        (pkg) => id === pkg || id.startsWith(pkg + '/')
      );
      if (pkgName) {
        // Return a virtual module ID with syntheticNamedExports
        return {
          id: STUB_PREFIX + id,
          syntheticNamedExports: true
        };
      }
      return undefined;
    },

    load(id) {
      if (id === RESOLVED_VIRTUAL_MODULE_ID) {
        return `export default ${JSON.stringify(runtimeConfig, null, 2)};`;
      }
      // Load stub content for disabled packages
      if (id.startsWith(STUB_PREFIX)) {
        // Return a module that exports a default object with syntheticNamedExports
        // Any named import will be resolved from the default export
        return `
          const noop = () => undefined;
          const useStub = () => ({});
          const ComponentStub = () => null;
          const stubProxy = new Proxy({}, {
            get(_, prop) {
              if (typeof prop === 'string') {
                if (prop.startsWith('use')) return useStub;
                if (prop[0] === prop[0]?.toUpperCase()) return ComponentStub;
              }
              return noop;
            }
          });
          export default stubProxy;
        `;
      }
      return undefined;
    },

    configResolved() {
      // Log which app is being built
      const featureCount = config.features.length;
      const disabledCount = disabledPackages.length;
      console.log(`\n  App: ${config.displayName} (${appId})`);
      console.log(`  Features: ${featureCount} enabled, ${disabledCount} disabled`);
      if (disabledPackages.length > 0) {
        console.log(`  Tree-shaking: ${disabledPackages.join(', ')}\n`);
      }
    }
  };

  return { plugin, config, disabledPackages };
}
