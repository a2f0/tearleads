import type { Command } from 'commander';
import {
  closePostgresPool,
  getPostgresConnectionInfo,
  getPostgresPool
} from '../lib/postgres.js';
import { closeRedisClient } from '../lib/redis.js';
import { getLatestLastActiveByUserIds } from '../lib/sessions.js';

type ParsedArgs = {
  dryRun: boolean;
  batchSize: number;
  help: boolean;
};

type SyncLastActiveOptions = {
  dryRun?: boolean;
  batchSize?: string;
};

type SyncLastActiveResult = {
  processed: number;
  updated: number;
};

const DEFAULT_BATCH_SIZE = 100;

function printUsage(): void {
  console.log(
    [
      'Usage:',
      '  pnpm --filter @rapid/api cli sync-last-active',
      '  pnpm --filter @rapid/api cli sync-last-active -- --dry-run',
      '  pnpm --filter @rapid/api cli sync-last-active -- --batch-size 50',
      '',
      'Options:',
      '  --dry-run             Show what would be updated without making changes.',
      '  --batch-size <size>   Number of users to process per batch (default: 100).',
      '  --help, -h            Show this help message.',
      '',
      'Environment:',
      '  DATABASE_URL or POSTGRES_URL take precedence.',
      '  Otherwise PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE are used.',
      '  REDIS_URL for Redis connection (default: redis://localhost:6379).'
    ].join('\n')
  );
}

function parseArgs(argv: string[]): ParsedArgs {
  let dryRun = false;
  let batchSize = DEFAULT_BATCH_SIZE;
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) {
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }

    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }

    if (arg.startsWith('--batch-size=')) {
      batchSize = parseInt(arg.slice('--batch-size='.length), 10);
      if (Number.isNaN(batchSize) || batchSize <= 0) {
        throw new Error('Invalid batch size. Must be a positive integer.');
      }
      continue;
    }

    if (arg === '--batch-size') {
      const value = argv[index + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('Missing value for --batch-size.');
      }
      batchSize = parseInt(value, 10);
      if (Number.isNaN(batchSize) || batchSize <= 0) {
        throw new Error('Invalid batch size. Must be a positive integer.');
      }
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { dryRun, batchSize, help };
}

function buildConnectionLabel(): string {
  const info = getPostgresConnectionInfo();
  const database = info.database ?? null;
  if (!database) {
    throw new Error(
      'Missing Postgres connection info. Set DATABASE_URL or PGDATABASE/POSTGRES_DATABASE (plus PGHOST/PGPORT/PGUSER as needed).'
    );
  }

  const labelParts = [
    info.host ? `host=${info.host}` : null,
    info.port ? `port=${info.port}` : null,
    info.user ? `user=${info.user}` : null,
    `database=${database}`
  ].filter((value): value is string => Boolean(value));

  return labelParts.join(', ');
}

async function syncLastActive(
  dryRun: boolean,
  batchSize: number
): Promise<SyncLastActiveResult> {
  const label = buildConnectionLabel();
  console.log(`Postgres connection: ${label}`);

  const pool = await getPostgresPool();

  const usersResult = await pool.query<{ id: string }>(
    'SELECT id FROM users ORDER BY id'
  );
  const userIds = usersResult.rows.map((row) => row.id);

  console.log(`Found ${userIds.length} users to process`);

  if (userIds.length === 0) {
    return { processed: 0, updated: 0 };
  }

  let processed = 0;
  let updated = 0;

  for (let i = 0; i < userIds.length; i += batchSize) {
    const batch = userIds.slice(i, i + batchSize);
    const lastActiveByUser = await getLatestLastActiveByUserIds(batch);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      for (const userId of batch) {
        const lastActiveAt = lastActiveByUser[userId];
        if (lastActiveAt) {
          if (!dryRun) {
            const result = await client.query(
              `UPDATE users SET last_active_at = $1
               WHERE id = $2 AND (last_active_at IS NULL OR last_active_at < $1)`,
              [lastActiveAt, userId]
            );
            if (result.rowCount && result.rowCount > 0) {
              updated += 1;
            }
          } else {
            updated += 1;
          }
        }
        processed += 1;
      }

      await client.query('COMMIT');
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Failed to rollback transaction:', rollbackError);
      }
      throw error;
    } finally {
      client.release();
    }

    console.log(`Processed ${processed}/${userIds.length} users`);
  }

  return { processed, updated };
}

export async function runSyncLastActive(
  options: SyncLastActiveOptions
): Promise<SyncLastActiveResult> {
  const dryRun = options.dryRun ?? false;
  const batchSize = options.batchSize
    ? parseInt(options.batchSize, 10)
    : DEFAULT_BATCH_SIZE;

  if (Number.isNaN(batchSize) || batchSize <= 0) {
    throw new Error('Invalid batch size. Must be a positive integer.');
  }

  return syncLastActive(dryRun, batchSize);
}

export async function runSyncLastActiveFromArgv(argv: string[]): Promise<void> {
  try {
    const parsed = parseArgs(argv);
    if (parsed.help) {
      printUsage();
      return;
    }

    const result = await syncLastActive(parsed.dryRun, parsed.batchSize);

    if (parsed.dryRun) {
      console.log(
        `[Dry run] Would update ${result.updated}/${result.processed} users`
      );
    } else {
      console.log(
        `Sync complete: ${result.updated}/${result.processed} users updated`
      );
    }
  } finally {
    await closeRedisClient();
    await closePostgresPool();
  }
}

export function syncLastActiveCommand(program: Command): void {
  program
    .command('sync-last-active')
    .description('Sync lastActiveAt from Redis sessions to PostgreSQL')
    .option('--dry-run', 'Show what would be updated without making changes')
    .option(
      '--batch-size <size>',
      'Number of users to process per batch',
      String(DEFAULT_BATCH_SIZE)
    )
    .action(async (options: SyncLastActiveOptions) => {
      let exitCode = 0;
      try {
        const result = await runSyncLastActive(options);

        if (options.dryRun) {
          console.log(
            `[Dry run] Would update ${result.updated}/${result.processed} users`
          );
        } else {
          console.log(
            `Sync complete: ${result.updated}/${result.processed} users updated`
          );
        }
      } catch (error) {
        exitCode = 1;
        console.error('\nSync failed:');
        console.error(error instanceof Error ? error.message : String(error));
      } finally {
        await closeRedisClient();
        await closePostgresPool();
        process.exit(exitCode);
      }
    });
}
