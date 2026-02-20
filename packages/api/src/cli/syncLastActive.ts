import { closeRedisClient } from '@tearleads/shared/redis';
import type { Command } from 'commander';
import { buildPostgresConnectionLabel } from '../lib/cliPostgres.js';
import { closePostgresPool, getPostgresPool } from '../lib/postgres.js';
import { getLatestLastActiveByUserIds } from '../lib/sessions.js';

type SyncLastActiveOptions = {
  dryRun?: boolean;
  batchSize?: string;
};

type SyncLastActiveResult = {
  processed: number;
  updated: number;
};

const DEFAULT_BATCH_SIZE = 100;

async function syncLastActive(
  dryRun: boolean,
  batchSize: number
): Promise<SyncLastActiveResult> {
  const label = buildPostgresConnectionLabel();
  console.log(`Postgres connection: ${label}`);

  const pool = await getPostgresPool();

  // Get total count for progress reporting
  const countResult = await pool.query<{ count: string }>(
    'SELECT COUNT(*) as count FROM users'
  );
  const totalUsers = parseInt(countResult.rows[0]?.count ?? '0', 10);
  console.log(`Found ${totalUsers} users to process`);

  if (totalUsers === 0) {
    return { processed: 0, updated: 0 };
  }

  let processed = 0;
  let updated = 0;
  let lastId: string | null = null;

  // Process users in batches using cursor-based pagination
  while (processed < totalUsers) {
    // Fetch next batch of user IDs using keyset pagination
    const batchQuery: string = lastId
      ? 'SELECT id FROM users WHERE id > $1 ORDER BY id LIMIT $2'
      : 'SELECT id FROM users ORDER BY id LIMIT $1';
    const batchParams: (string | number)[] = lastId
      ? [lastId, batchSize]
      : [batchSize];

    const batchResult = await pool.query<{ id: string }>(
      batchQuery,
      batchParams
    );
    const batch: string[] = batchResult.rows.map((row) => row.id);

    if (batch.length === 0) {
      break;
    }

    lastId = batch[batch.length - 1] ?? null;
    const lastActiveByUser = await getLatestLastActiveByUserIds(batch);

    // Build arrays for batch update
    const userIdsToUpdate: string[] = [];
    const timestampsToUpdate: string[] = [];

    for (const userId of batch) {
      const lastActiveAt = lastActiveByUser[userId];
      if (lastActiveAt) {
        userIdsToUpdate.push(userId);
        timestampsToUpdate.push(lastActiveAt);
      }
      processed += 1;
    }

    if (userIdsToUpdate.length > 0 && !dryRun) {
      // Batch update using unnest for efficiency
      const result = await pool.query(
        `UPDATE users AS u
         SET last_active_at = v.last_active_at
         FROM (SELECT unnest($1::text[]) AS id, unnest($2::timestamptz[]) AS last_active_at) AS v
         WHERE u.id = v.id AND (u.last_active_at IS NULL OR u.last_active_at < v.last_active_at)`,
        [userIdsToUpdate, timestampsToUpdate]
      );
      updated += result.rowCount ?? 0;
    } else if (dryRun) {
      updated += userIdsToUpdate.length;
    }

    console.log(`Processed ${processed}/${totalUsers} users`);
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
