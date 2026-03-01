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
    .action(async (options: CliOptions) => {
      let client: PoolClient | null = null;
      try {
        const pool = await getPostgresPool();
        client = await pool.connect();

        const result = await repairVfsSharePolicyAclDrift(client, {
          dryRun: options.dryRun ?? false
        });
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
