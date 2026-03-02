import type { Command } from 'commander';
import type { PoolClient } from 'pg';
import { closePostgresPool, getPostgresPool } from '../lib/postgres.js';
import {
  type RepairVfsSharePolicyAclDriftResult,
  repairVfsSharePolicyAclDrift
} from '../lib/vfsSharePolicyDriftRepair.js';

interface CliOptions {
  dryRun?: boolean;
  json?: boolean;
  maxExpandedMatchCount?: string;
  maxDecisionCount?: string;
  lockTimeoutMs?: string;
  statementTimeoutMs?: string;
  emitMetrics?: boolean;
}

function parseNonNegativeIntegerOption(
  rawValue: string | undefined,
  optionName: string
): number | undefined {
  if (rawValue === undefined) {
    return undefined;
  }

  const parsedValue = Number(rawValue);
  if (!Number.isInteger(parsedValue) || parsedValue < 0) {
    throw new Error(`${optionName} must be a non-negative integer`);
  }
  return parsedValue;
}

function printHumanResult(result: RepairVfsSharePolicyAclDriftResult): void {
  console.log('VFS share policy drift repair');
  console.log('=============================');
  console.log(`mode: ${result.mode}`);
  console.log(`compilerRunId: ${result.compileResult.compilerRunId}`);
  console.log(`policyCount: ${result.compileResult.policyCount}`);
  console.log(`activePolicyCount: ${result.compileResult.activePolicyCount}`);
  console.log(`selectorCount: ${result.compileResult.selectorCount}`);
  console.log(`principalCount: ${result.compileResult.principalCount}`);
  console.log(`expandedMatchCount: ${result.compileResult.expandedMatchCount}`);
  console.log(`decisionsCount: ${result.compileResult.decisionsCount}`);
  console.log(
    `touchedAclEntryCount: ${result.compileResult.touchedAclEntryCount}`
  );
  console.log(
    `staleRevocationCount: ${result.compileResult.staleRevocationCount}`
  );
}

export function vfsSharePolicyRepairCommand(program: Command): void {
  program
    .command('vfs-share-policy-repair')
    .description(
      'Repair policy-derived ACL drift via full share-policy compile'
    )
    .option('--dry-run', 'Compute drift repair plan without writing ACL rows')
    .option('--json', 'Print machine-readable JSON output')
    .option(
      '--max-expanded-match-count <count>',
      'Guardrail upper bound for expanded policy matches'
    )
    .option(
      '--max-decision-count <count>',
      'Guardrail upper bound for compiled decisions'
    )
    .option(
      '--lock-timeout-ms <ms>',
      'Transaction-local lock timeout for compile queries'
    )
    .option(
      '--statement-timeout-ms <ms>',
      'Transaction-local statement timeout for compile queries'
    )
    .option('--emit-metrics', 'Force-emit structured compiler run metrics')
    .action(async (options: CliOptions) => {
      let client: PoolClient | null = null;
      try {
        const pool = await getPostgresPool();
        client = await pool.connect();

        const maxExpandedMatchCount = parseNonNegativeIntegerOption(
          options.maxExpandedMatchCount,
          'max-expanded-match-count'
        );
        const maxDecisionCount = parseNonNegativeIntegerOption(
          options.maxDecisionCount,
          'max-decision-count'
        );
        const lockTimeoutMs = parseNonNegativeIntegerOption(
          options.lockTimeoutMs,
          'lock-timeout-ms'
        );
        const statementTimeoutMs = parseNonNegativeIntegerOption(
          options.statementTimeoutMs,
          'statement-timeout-ms'
        );
        const repairOptions: NonNullable<
          Parameters<typeof repairVfsSharePolicyAclDrift>[1]
        > = {
          dryRun: options.dryRun ?? false
        };
        if (maxExpandedMatchCount !== undefined) {
          repairOptions.maxExpandedMatchCount = maxExpandedMatchCount;
        }
        if (maxDecisionCount !== undefined) {
          repairOptions.maxDecisionCount = maxDecisionCount;
        }
        if (lockTimeoutMs !== undefined) {
          repairOptions.lockTimeoutMs = lockTimeoutMs;
        }
        if (statementTimeoutMs !== undefined) {
          repairOptions.statementTimeoutMs = statementTimeoutMs;
        }
        if (options.emitMetrics !== undefined) {
          repairOptions.emitMetrics = options.emitMetrics;
        }

        const result = await repairVfsSharePolicyAclDrift(client, repairOptions);
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          printHumanResult(result);
        }
      } catch (error) {
        console.error('Failed to run VFS share policy drift repair:');
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      } finally {
        if (client) {
          client.release();
        }
        await closePostgresPool();
      }
    });
}
