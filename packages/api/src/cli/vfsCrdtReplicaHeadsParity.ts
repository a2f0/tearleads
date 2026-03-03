import type { Command } from 'commander';
import { closePostgresPool, getPostgresPool } from '../lib/postgres.js';
import {
  checkVfsCrdtReplicaHeadsParity,
  DEFAULT_VFS_CRDT_REPLICA_HEADS_PARITY_SAMPLE_LIMIT,
  type VfsCrdtReplicaHeadsParityResult
} from '../lib/vfsCrdtReplicaHeadsParity.js';

interface CliOptions {
  json?: boolean;
  failOnMismatch?: boolean;
  sampleLimit?: string;
}

interface VfsCrdtReplicaHeadsParityMetric {
  metricVersion: 1;
  event: 'vfs_crdt_replica_heads_parity';
  occurredAt: string;
  success: boolean;
  durationMs: number;
  checkedPairCount: number | null;
  mismatchCount: number | null;
  missingHeadCount: number | null;
  staleHeadCount: number | null;
  writeIdMismatchCount: number | null;
  occurredAtMismatchCount: number | null;
  sampledMismatchCount: number | null;
  sampleLimit: number | null;
  error: string | null;
}

function parseNonNegativeIntegerOption(
  rawValue: string | undefined,
  optionName: string
): number | undefined {
  if (rawValue === undefined) {
    return undefined;
  }

  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${optionName} must be a non-negative integer`);
  }

  return parsed;
}

function toErrorMessage(error: unknown): string | null {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return null;
}

function buildParityMetric(input: {
  success: boolean;
  durationMs: number;
  result: VfsCrdtReplicaHeadsParityResult | null;
  error?: unknown;
  occurredAt?: Date;
}): VfsCrdtReplicaHeadsParityMetric {
  const result = input.result;

  return {
    metricVersion: 1,
    event: 'vfs_crdt_replica_heads_parity',
    occurredAt: (input.occurredAt ?? new Date()).toISOString(),
    success: input.success,
    durationMs: Math.max(0, Math.trunc(input.durationMs)),
    checkedPairCount: result?.checkedPairCount ?? null,
    mismatchCount: result?.mismatchCount ?? null,
    missingHeadCount: result?.missingHeadCount ?? null,
    staleHeadCount: result?.staleHeadCount ?? null,
    writeIdMismatchCount: result?.writeIdMismatchCount ?? null,
    occurredAtMismatchCount: result?.occurredAtMismatchCount ?? null,
    sampledMismatchCount: result?.sampledMismatchCount ?? null,
    sampleLimit: result?.sampleLimit ?? null,
    error: toErrorMessage(input.error)
  };
}

function emitParityMetric(metric: VfsCrdtReplicaHeadsParityMetric): void {
  console.error(JSON.stringify(metric));
}

function printHumanResult(result: VfsCrdtReplicaHeadsParityResult): void {
  console.log('VFS CRDT replica-head parity check');
  console.log('=================================');
  console.log(`checkedPairCount: ${result.checkedPairCount}`);
  console.log(`mismatchCount: ${result.mismatchCount}`);
  console.log(`missingHeadCount: ${result.missingHeadCount}`);
  console.log(`staleHeadCount: ${result.staleHeadCount}`);
  console.log(`writeIdMismatchCount: ${result.writeIdMismatchCount}`);
  console.log(`occurredAtMismatchCount: ${result.occurredAtMismatchCount}`);
  console.log(`sampleLimit: ${result.sampleLimit}`);
  console.log(`sampledMismatchCount: ${result.sampledMismatchCount}`);

  if (result.mismatches.length > 0) {
    console.log('sampledMismatches:');
    for (const mismatch of result.mismatches) {
      console.log(
        [
          `  actor=${mismatch.actorId ?? 'null'}`,
          `replica=${mismatch.replicaId ?? 'null'}`,
          `expectedWriteId=${mismatch.expectedMaxWriteId ?? 'null'}`,
          `actualWriteId=${mismatch.actualMaxWriteId ?? 'null'}`,
          `expectedOccurredAt=${mismatch.expectedMaxOccurredAt ?? 'null'}`,
          `actualOccurredAt=${mismatch.actualMaxOccurredAt ?? 'null'}`,
          `reason=${mismatch.reason}`
        ].join(' ')
      );
    }
  }
}

export async function runVfsCrdtReplicaHeadsParity(
  options: CliOptions
): Promise<VfsCrdtReplicaHeadsParityResult> {
  const sampleLimit =
    parseNonNegativeIntegerOption(options.sampleLimit, 'sample-limit') ??
    DEFAULT_VFS_CRDT_REPLICA_HEADS_PARITY_SAMPLE_LIMIT;
  const pool = await getPostgresPool();
  const client = await pool.connect();
  try {
    return await checkVfsCrdtReplicaHeadsParity(client, { sampleLimit });
  } finally {
    client.release();
  }
}

export function vfsCrdtReplicaHeadsParityCommand(program: Command): void {
  program
    .command('vfs-crdt-replica-heads-parity')
    .description('Audit vfs_crdt_replica_heads against canonical vfs_crdt_ops')
    .option('--json', 'Print machine-readable JSON output')
    .option(
      '--sample-limit <count>',
      'Limit mismatch rows printed in output (default: 100)'
    )
    .option(
      '--fail-on-mismatch',
      'Exit non-zero when parity mismatches are detected'
    )
    .action(async (options: CliOptions) => {
      const startedAtMs = Date.now();
      let result: VfsCrdtReplicaHeadsParityResult | null = null;
      try {
        result = await runVfsCrdtReplicaHeadsParity(options);
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          printHumanResult(result);
        }

        emitParityMetric(
          buildParityMetric({
            success: true,
            durationMs: Date.now() - startedAtMs,
            result
          })
        );

        if ((options.failOnMismatch ?? false) && result.mismatchCount > 0) {
          process.exitCode = 1;
        }
      } catch (error) {
        console.error('Failed to run VFS CRDT replica-head parity check:');
        console.error(error instanceof Error ? error.message : String(error));
        emitParityMetric(
          buildParityMetric({
            success: false,
            durationMs: Date.now() - startedAtMs,
            result,
            error
          })
        );
        process.exitCode = 1;
      } finally {
        await closePostgresPool();
      }
    });
}
