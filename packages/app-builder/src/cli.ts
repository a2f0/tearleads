#!/usr/bin/env tsx
import { program } from 'commander';
import { getDisabledPackages, getEnabledPackages } from './feature-map.js';
import { listApps, loadAppConfig } from './loader.js';

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
 * (Placeholder - will be implemented in later phases)
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
  .action(
    async (options: { app: string; platform: string; output?: string }) => {
      try {
        const { config } = await loadAppConfig(options.app);
        console.log(
          `Generating configs for "${config.displayName}" (${options.app})...`
        );
        console.log(`  Bundle ID (iOS): ${config.bundleIds.ios}`);
        console.log(`  Platform: ${options.platform}`);
        console.log(`  Output: ${options.output || 'packages/client'}`);

        // TODO: Implement generators in Phase 2+
        console.log('\nGeneration not yet implemented. Coming in Phase 2.');
      } catch (error) {
        console.error(`Error: ${(error as Error).message}`);
        process.exit(1);
      }
    }
  );

program.parse();
