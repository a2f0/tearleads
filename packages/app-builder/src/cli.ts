#!/usr/bin/env tsx
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { program } from 'commander';
import { getDisabledPackages, getEnabledPackages } from './feature-map.js';
import {
  generateAppMetadataJson,
  generateCapacitorConfig
} from './generators/index.js';
import { listApps, loadAppConfig } from './loader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Get the default output directory (packages/client) */
function getDefaultOutputDir(): string {
  return resolve(__dirname, '..', '..', 'client');
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
        console.error(`Validation failed: ${(error as Error).message}`);
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
          console.error(`[FAIL] ${appId}: ${(error as Error).message}`);
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
      console.error(`Error: ${(error as Error).message}`);
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
        console.error(`Error: ${(error as Error).message}`);
        process.exit(1);
      }
    }
  );

/**
 * Generate configuration files for an app.
 */
program
  .command('generate')
  .description('Generate configuration files for an app')
  .requiredOption('-a, --app <id>', 'App ID')
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
      app: string;
      platform: string;
      output?: string;
      dryRun?: boolean;
    }) => {
      try {
        const { config } = await loadAppConfig(options.app);
        const outputDir = options.output || getDefaultOutputDir();

        console.log(
          `Generating configs for "${config.displayName}" (${options.app})...`
        );
        console.log(`  Bundle ID (iOS): ${config.bundleIds.ios}`);
        console.log(`  Bundle ID (Android): ${config.bundleIds.android}`);
        console.log(`  Output: ${outputDir}`);
        console.log('');

        const filesToWrite: Array<{ path: string; content: string }> = [];

        // Generate capacitor.config.ts
        if (
          options.platform === 'all' ||
          options.platform === 'ios' ||
          options.platform === 'android'
        ) {
          filesToWrite.push({
            path: join(outputDir, 'capacitor.config.ts'),
            content: generateCapacitorConfig(config)
          });
        }

        // Generate app metadata JSON for build-time injection
        const generatedDir = join(outputDir, 'generated');
        filesToWrite.push({
          path: join(generatedDir, 'app-config.json'),
          content: generateAppMetadataJson(config)
        });

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
        console.error(`Error: ${(error as Error).message}`);
        process.exit(1);
      }
    }
  );

program.parse();
