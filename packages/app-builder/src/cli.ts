#!/usr/bin/env tsx
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getErrorMessage } from '@tearleads/shared';
import { program } from 'commander';
import { getDisabledPackages, getEnabledPackages } from './featureMap.js';
import {
  generateAppConfigGradle,
  generateAppfile,
  generateAppMetadataJson,
  generateAppThemeCss,
  generateCapacitorConfig,
  generateEnvScript,
  generateMatchfile,
  generateStringsXml,
  generateXcconfig
} from './generators/index.js';
import { DEFAULT_APP_ID, listApps, loadAppConfig } from './loader.js';
import type { AppConfig } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Get the default output directory (packages/client) */
function getDefaultOutputDir(): string {
  return resolve(__dirname, '..', '..', 'client');
}

/**
 * Copy app-specific assets (icons, splash) if they exist.
 */
function copyAssets(
  config: AppConfig,
  assetsDir: string,
  outputDir: string,
  dryRun?: boolean
): void {
  const assetsToCopy = [
    { src: config.assets?.iconSource, dest: 'resources/icon.png' },
    { src: config.assets?.splashSource, dest: 'resources/splash.png' }
  ];

  for (const asset of assetsToCopy) {
    if (asset.src) {
      const srcPath = resolve(assetsDir, '..', asset.src);
      const destPath = join(outputDir, asset.dest);

      if (existsSync(srcPath)) {
        if (dryRun) {
          console.log(`[dry-run] Would copy: ${srcPath} -> ${destPath}`);
        } else {
          const dir = dirname(destPath);
          if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
          }
          copyFileSync(srcPath, destPath);
          console.log(`  Copied: ${asset.dest}`);
        }
      } else {
        console.warn(`  Warning: Asset source not found: ${srcPath}`);
      }
    }
  }
}

program
  .name('app-builder')
  .description('White-label app builder CLI')
  .version('1.0.0');

/**
 * List all available apps.
 */
program
  .command('list')
  .description('List all available apps')
  .option('--json', 'Output as JSON')
  .action(async (options: { json?: boolean }) => {
    const apps = listApps();

    if (options.json) {
      console.log(JSON.stringify(apps, null, 2));
    } else {
      console.log('Available apps:');
      for (const app of apps) {
        console.log(`  - ${app}`);
      }
    }
  });

/**
 * Validate app configuration(s).
 */
program
  .command('validate')
  .description('Validate app configuration(s)')
  .option('-a, --app <id>', 'Validate a specific app')
  .option('--all', 'Validate all apps')
  .action(async (options: { app?: string; all?: boolean }) => {
    if (options.app) {
      // Validate specific app
      try {
        const loaded = await loadAppConfig(options.app);
        console.log(`App "${options.app}" is valid.`);
        console.log(`  Display name: ${loaded.config.displayName}`);
        console.log(`  Platforms: ${loaded.config.platforms.join(', ')}`);
        console.log(`  Features: ${loaded.config.features.join(', ')}`);
      } catch (error) {
        console.error(`Validation failed: ${getErrorMessage(error)}`);
        process.exit(1);
      }
    } else if (options.all) {
      // Validate all apps
      const apps = listApps();
      let hasErrors = false;

      for (const appId of apps) {
        try {
          await loadAppConfig(appId);
          console.log(`[OK] ${appId}`);
        } catch (error) {
          console.error(`[FAIL] ${appId}: ${getErrorMessage(error)}`);
          hasErrors = true;
        }
      }

      if (hasErrors) {
        process.exit(1);
      }
    } else {
      console.error('Specify --app <id> or --all');
      process.exit(1);
    }
  });

/**
 * Dump app configuration as JSON.
 */
program
  .command('dump')
  .description('Dump app configuration as JSON')
  .requiredOption('-a, --app <id>', 'App ID to dump')
  .option('--format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (options: { app: string; format: string }) => {
    try {
      const loaded = await loadAppConfig(options.app);

      if (options.format === 'json') {
        console.log(JSON.stringify(loaded.config));
      } else {
        console.log(JSON.stringify(loaded.config, null, 2));
      }
    } catch (error) {
      console.error(`Error: ${getErrorMessage(error)}`);
      process.exit(1);
    }
  });

/**
 * Show packages enabled/disabled for an app.
 */
program
  .command('packages')
  .description('Show packages enabled/disabled for an app')
  .requiredOption('-a, --app <id>', 'App ID')
  .option('--enabled', 'Show only enabled packages')
  .option('--disabled', 'Show only disabled packages')
  .option('--json', 'Output as JSON')
  .action(
    async (options: {
      app: string;
      enabled?: boolean;
      disabled?: boolean;
      json?: boolean;
    }) => {
      try {
        const loaded = await loadAppConfig(options.app);
        const enabled = getEnabledPackages(loaded.config.features);
        const disabled = getDisabledPackages(loaded.config.features);

        if (options.json) {
          if (options.enabled) {
            console.log(JSON.stringify(enabled));
          } else if (options.disabled) {
            console.log(JSON.stringify(disabled));
          } else {
            console.log(JSON.stringify({ enabled, disabled }));
          }
        } else {
          if (!options.disabled) {
            console.log(`Enabled packages (${enabled.length}):`);
            for (const pkg of enabled) {
              console.log(`  + ${pkg}`);
            }
          }
          if (!options.enabled) {
            if (!options.disabled) console.log('');
            console.log(`Disabled packages (${disabled.length}):`);
            for (const pkg of disabled) {
              console.log(`  - ${pkg}`);
            }
          }
        }
      } catch (error) {
        console.error(`Error: ${getErrorMessage(error)}`);
        process.exit(1);
      }
    }
  );

/**
 * Packages that require explicit build before client build.
 * Core packages and feature packages that have build scripts.
 */
const PACKAGES_REQUIRING_BUILD = [
  '@tearleads/api', // OpenAPI spec generation
  '@tearleads/window-manager',
  '@tearleads/ui',
  '@tearleads/notes',
  '@tearleads/email',
  '@tearleads/vfs-explorer',
  '@tearleads/audio',
  '@tearleads/contacts',
  '@tearleads/db-test-utils',
  '@tearleads/health'
] as const;

/**
 * Output build commands for an app's enabled packages.
 */
program
  .command('build-deps')
  .description('Output build commands for app dependencies')
  .requiredOption('-a, --app <id>', 'App ID')
  .option('--shell', 'Output as shell script')
  .option('--json', 'Output as JSON array')
  .action(async (options: { app: string; shell?: boolean; json?: boolean }) => {
    try {
      const loaded = await loadAppConfig(options.app);
      const enabled = new Set(getEnabledPackages(loaded.config.features));

      // Filter to only packages that need building AND are enabled for this app
      // Always include @tearleads/api for OpenAPI spec
      const packagesToBuild = PACKAGES_REQUIRING_BUILD.filter(
        (pkg) => pkg === '@tearleads/api' || enabled.has(pkg)
      );

      if (options.json) {
        console.log(JSON.stringify(packagesToBuild));
      } else if (options.shell) {
        for (const pkg of packagesToBuild) {
          console.log(`pnpm --filter ${pkg} build`);
        }
      } else {
        console.log(`Build commands for "${options.app}":`);
        for (const pkg of packagesToBuild) {
          console.log(`  pnpm --filter ${pkg} build`);
        }
      }
    } catch (error) {
      console.error(`Error: ${getErrorMessage(error)}`);
      process.exit(1);
    }
  });

/**
 * Generate configuration files for an app.
 */
program
  .command('generate')
  .description('Generate configuration files for an app')
  .option('-a, --app <id>', 'App ID')
  .option('-d, --default', `Use the default app (${DEFAULT_APP_ID})`)
  .option(
    '-p, --platform <platform>',
    'Platform (ios, android, desktop, pwa, all)',
    'all'
  )
  .option(
    '-o, --output <dir>',
    'Output directory (defaults to packages/client)'
  )
  .option('--dry-run', 'Show what would be generated without writing files')
  .action(
    async (options: {
      app?: string;
      default?: boolean;
      platform: string;
      output?: string;
      dryRun?: boolean;
    }) => {
      // Determine app ID: --app takes precedence, then --default, then error
      let appId: string;
      if (options.app) {
        appId = options.app;
      } else if (options.default) {
        appId = DEFAULT_APP_ID;
      } else {
        console.error('Specify --app <id> or --default');
        process.exit(1);
      }

      try {
        const { config, assetsDir } = await loadAppConfig(appId);
        const outputDir = options.output || getDefaultOutputDir();

        console.log(
          `Generating configs for "${config.displayName}" (${appId})...`
        );
        console.log(`  Bundle ID (iOS): ${config.bundleIds.ios}`);
        console.log(`  Bundle ID (Android): ${config.bundleIds.android}`);
        console.log(`  Output: ${outputDir}`);
        console.log('');

        const filesToWrite: Array<{ path: string; content: string }> = [];

        const shouldGenerateIos =
          options.platform === 'all' || options.platform === 'ios';
        const shouldGenerateAndroid =
          options.platform === 'all' || options.platform === 'android';

        // Generate capacitor.config.ts (shared by iOS and Android)
        if (shouldGenerateIos || shouldGenerateAndroid) {
          filesToWrite.push({
            path: join(outputDir, 'capacitor.config.ts'),
            content: generateCapacitorConfig(config)
          });
        }

        // Generate iOS-specific files
        if (shouldGenerateIos) {
          // Fastlane Appfile
          filesToWrite.push({
            path: join(outputDir, 'fastlane', 'Appfile'),
            content: generateAppfile(config)
          });

          // Fastlane Matchfile
          filesToWrite.push({
            path: join(outputDir, 'fastlane', 'Matchfile'),
            content: generateMatchfile(config)
          });

          // xcconfig for build settings
          filesToWrite.push({
            path: join(outputDir, 'ios', 'App', 'App.xcconfig'),
            content: generateXcconfig(config)
          });
        }

        // Generate Android-specific files
        if (shouldGenerateAndroid) {
          // strings.xml with app name
          filesToWrite.push({
            path: join(
              outputDir,
              'android',
              'app',
              'src',
              'main',
              'res',
              'values',
              'strings.xml'
            ),
            content: generateStringsXml(config)
          });

          // Gradle config fragment
          filesToWrite.push({
            path: join(outputDir, 'android', 'app-config.gradle'),
            content: generateAppConfigGradle(config)
          });
        }

        // Generate app metadata JSON for build-time injection
        const generatedDir = join(outputDir, 'generated');
        filesToWrite.push({
          path: join(generatedDir, 'app-config.json'),
          content: generateAppMetadataJson(config)
        });

        // Generate app-theme.css for CSS variable injection
        filesToWrite.push({
          path: join(generatedDir, 'app-theme.css'),
          content: generateAppThemeCss(config)
        });

        // Generate environment script for CI
        filesToWrite.push({
          path: join(generatedDir, 'env.sh'),
          content: generateEnvScript(config)
        });

        // Copy assets
        copyAssets(config, assetsDir, outputDir, options.dryRun);

        // Write files
        for (const file of filesToWrite) {
          if (options.dryRun) {
            console.log(`[dry-run] Would write: ${file.path}`);
            console.log('---');
            console.log(file.content);
            console.log('---\n');
          } else {
            const dir = dirname(file.path);
            if (!existsSync(dir)) {
              mkdirSync(dir, { recursive: true });
            }
            writeFileSync(file.path, file.content, 'utf-8');
            console.log(`  Written: ${file.path}`);
          }
        }

        if (!options.dryRun) {
          console.log(`\nGenerated ${filesToWrite.length} file(s).`);
        }
      } catch (error) {
        console.error(`Error: ${getErrorMessage(error)}`);
        process.exit(1);
      }
    }
  );

program.parse();
