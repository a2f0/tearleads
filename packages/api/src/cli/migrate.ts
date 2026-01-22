import type { Command } from 'commander';
import { closePostgresPool, getPostgresPool } from '../lib/postgres.js';
import {
  getCurrentVersion,
  migrations,
  runMigrations
} from '../migrations/index.js';
import type { Migration } from '../migrations/types.js';

export function migrateCommand(program: Command): void {
  program
    .command('migrate')
    .description('Run pending database migrations')
    .option('--dry-run', 'Show pending migrations without applying them')
    .option('--status', 'Show current migration status only')
    .action(async (options: { dryRun?: boolean; status?: boolean }) => {
      try {
        await runMigrate(options);
        process.exit(0);
      } catch (error) {
        console.error('\nMigration failed:');
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      } finally {
        await closePostgresPool();
      }
    });
}

async function runMigrate(options: {
  dryRun?: boolean;
  status?: boolean;
}): Promise<void> {
  console.log('Rapid API Database Migrations');
  console.log('=============================\n');

  const pool = await getPostgresPool();

  const currentVersion = await getCurrentVersion(pool);
  console.log(`Current schema version: ${currentVersion}`);
  console.log(`Available migrations: ${migrations.length}`);

  const pending = migrations.filter(
    (m: Migration) => m.version > currentVersion
  );

  if (pending.length === 0) {
    console.log('\nDatabase is up to date. No pending migrations.');
    return;
  }

  console.log(`Pending migrations: ${pending.length}\n`);

  for (const migration of pending) {
    console.log(
      `  v${String(migration.version).padStart(3, '0')}: ${migration.description}`
    );
  }

  if (options.status) {
    return;
  }

  if (options.dryRun) {
    console.log('\n[Dry run] No migrations were applied.');
    return;
  }

  console.log('\nApplying migrations...\n');
  const result = await runMigrations(pool);

  if (result.applied.length === 0) {
    console.log('No migrations were applied.');
  } else {
    console.log(`Applied ${result.applied.length} migration(s):`);
    for (const version of result.applied) {
      const migration = migrations.find(
        (m: Migration) => m.version === version
      );
      if (migration) {
        console.log(
          `  v${String(version).padStart(3, '0')}: ${migration.description}`
        );
      }
    }
  }

  console.log(`\nSchema version: ${result.currentVersion}`);
}
