import type { Command } from 'commander';
import type { PoolClient } from 'pg';
import { closePostgresPool, getPostgresPool } from '../lib/postgres.js';
import {
  executeVfsCrdtCompaction,
  planVfsCrdtCompaction,
  type VfsCrdtCompactionOptions,
  type VfsCrdtCompactionPlan
} from '../lib/vfsCrdtCompaction.js';
import {
  buildVfsCrdtCompactionRunMetric,
  emitVfsCrdtCompactionRunMetric
} from '../lib/vfsCrdtCompactionMetrics.js';

interface CliOptions {
  execute?: boolean;
  json?: boolean;
  hotRetentionDays?: string;
  inactiveClientDays?: string;
  safetyBufferHours?: string;
  clientPrefix?: string;
  maxDeleteRows?: string;
}

function parseNumberOption(
  raw: string | undefined,
  name: string
): number | undefined {
  if (raw === undefined) {
    return undefined;
  }

  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative number`);
  }

  return parsed;
}

function parsePositiveIntegerOption(
  raw: string | undefined,
  name: string
): number | undefined {
  const parsed = parseNumberOption(raw, name);
  if (parsed === undefined) {
    return undefined;
  }

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

function toMs(days: number | undefined): number | undefined {
  if (days === undefined) {
    return undefined;
  }

  return Math.trunc(days * 24 * 60 * 60 * 1000);
}

function toHoursMs(hours: number | undefined): number | undefined {
  if (hours === undefined) {
    return undefined;
  }

  return Math.trunc(hours * 60 * 60 * 1000);
}

function buildCompactionOptions(options: CliOptions): VfsCrdtCompactionOptions {
  const hotRetentionDays = parseNumberOption(
    options.hotRetentionDays,
    'hot-retention-days'
  );
  const inactiveClientDays = parseNumberOption(
    options.inactiveClientDays,
    'inactive-client-days'
  );
  const safetyBufferHours = parseNumberOption(
    options.safetyBufferHours,
    'safety-buffer-hours'
  );

  const built: VfsCrdtCompactionOptions = {};
  const hotRetentionMs = toMs(hotRetentionDays);
  const inactiveClientWindowMs = toMs(inactiveClientDays);
  const cursorSafetyBufferMs = toHoursMs(safetyBufferHours);

  if (hotRetentionMs !== undefined) {
    built.hotRetentionMs = hotRetentionMs;
  }
  if (inactiveClientWindowMs !== undefined) {
    built.inactiveClientWindowMs = inactiveClientWindowMs;
  }
  if (cursorSafetyBufferMs !== undefined) {
    built.cursorSafetyBufferMs = cursorSafetyBufferMs;
  }
  if (options.clientPrefix !== undefined) {
    built.clientIdPrefix = options.clientPrefix;
  }

  return built;
}

function printHumanPlan(
  plan: Awaited<ReturnType<typeof planVfsCrdtCompaction>>
): void {
  console.log('VFS CRDT compaction plan');
  console.log('=======================');
  console.log(`now: ${plan.now}`);
  console.log(
    `latestCursor: ${plan.latestCursor ? `${plan.latestCursor.changedAt} | ${plan.latestCursor.changeId}` : 'none'}`
  );
  console.log(`hotRetentionFloor: ${plan.hotRetentionFloor ?? 'none'}`);
  console.log(
    `oldestActiveCursor: ${plan.oldestActiveCursor ? `${plan.oldestActiveCursor.changedAt} | ${plan.oldestActiveCursor.changeId}` : 'none'}`
  );
  console.log(`cutoffOccurredAt: ${plan.cutoffOccurredAt ?? 'none'}`);
  console.log(`estimatedRowsToDelete: ${plan.estimatedRowsToDelete}`);
  console.log(`activeClientCount: ${plan.activeClientCount}`);
  console.log(`staleClientCount: ${plan.staleClientCount}`);
  if (plan.staleClientIds.length > 0) {
    console.log(`staleClientIds: ${plan.staleClientIds.join(', ')}`);
  }
  console.log(`note: ${plan.note}`);
}

export function vfsCrdtCompactionCommand(program: Command): void {
  program
    .command('vfs-crdt-compaction')
    .description('Plan or execute VFS CRDT operation-log compaction')
    .option(
      '--execute',
      'Apply deletion for the computed cutoff (default is dry-run)'
    )
    .option('--json', 'Print machine-readable JSON output')
    .option('--hot-retention-days <days>', 'Hot log retention window in days')
    .option(
      '--inactive-client-days <days>',
      'Client stale classification window in days'
    )
    .option(
      '--safety-buffer-hours <hours>',
      'Safety buffer subtracted from active frontier'
    )
    .option(
      '--client-prefix <prefix>',
      'Client id namespace prefix (default: crdt:)'
    )
    .option(
      '--max-delete-rows <rows>',
      'When executing, cap rows deleted in this run'
    )
    .action(async (options: CliOptions) => {
      let client: PoolClient | null = null;
      const startedAtMs = Date.now();
      let deletedRows = 0;
      let executed = false;
      let hasLoggedMetric = false;
      let plan: VfsCrdtCompactionPlan = {
        now: new Date(startedAtMs).toISOString(),
        latestCursor: null,
        hotRetentionFloor: null,
        activeClientCount: 0,
        staleClientCount: 0,
        oldestActiveCursor: null,
        cutoffOccurredAt: null,
        estimatedRowsToDelete: 0,
        staleClientIds: [],
        staleClientIdsTruncatedCount: 0,
        malformedClientStateCount: 0,
        blockedReason: null,
        note: 'Plan did not run'
      };
      try {
        const pool = await getPostgresPool();
        client = await pool.connect();

        const compactionOptions = buildCompactionOptions(options);
        plan = await planVfsCrdtCompaction(client, compactionOptions);

        if (options.execute && plan.cutoffOccurredAt) {
          await client.query('BEGIN');
          const maxDeleteRows = parsePositiveIntegerOption(
            options.maxDeleteRows,
            'max-delete-rows'
          );
          const executeOptions =
            maxDeleteRows === undefined ? {} : { maxDeleteRows };
          deletedRows = await executeVfsCrdtCompaction(
            client,
            plan,
            executeOptions
          );
          executed = true;
          await client.query('COMMIT');

          if (options.json) {
            console.log(JSON.stringify({ plan, deletedRows }, null, 2));
          } else {
            printHumanPlan(plan);
            console.log(`deletedRows: ${deletedRows}`);
          }
        } else {
          if (options.json) {
            console.log(JSON.stringify({ plan, deletedRows: 0 }, null, 2));
          } else {
            printHumanPlan(plan);
            console.log('mode: dry-run');
          }
        }

        emitVfsCrdtCompactionRunMetric(
          buildVfsCrdtCompactionRunMetric({
            plan,
            executed,
            success: true,
            deletedRows,
            durationMs: Date.now() - startedAtMs
          })
        );
        hasLoggedMetric = true;
      } catch (error) {
        if (client) {
          try {
            await client.query('ROLLBACK');
          } catch (rollbackError) {
            console.error(
              'Failed to rollback VFS CRDT compaction transaction:',
              rollbackError
            );
          }
        }

        console.error('Failed to run VFS CRDT compaction command:');
        console.error(error instanceof Error ? error.message : String(error));
        if (!hasLoggedMetric) {
          emitVfsCrdtCompactionRunMetric(
            buildVfsCrdtCompactionRunMetric({
              plan,
              executed,
              success: false,
              deletedRows,
              durationMs: Date.now() - startedAtMs,
              error
            })
          );
        }
        process.exitCode = 1;
      } finally {
        if (client) {
          client.release();
        }
        await closePostgresPool();
      }
    });
}
