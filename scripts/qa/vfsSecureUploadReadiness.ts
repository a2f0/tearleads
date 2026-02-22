#!/usr/bin/env tsx
import { spawn } from 'node:child_process';

type Check = {
  id: string;
  description: string;
  command: string;
  args: string[];
};

type CheckResult = {
  check: Check;
  success: boolean;
  durationMs: number;
};

const CHECKS: Check[] = [
  {
    id: 'api-rekey-crdt',
    description:
      'API rekey contract and encrypted CRDT envelope parser behavior remain deterministic',
    command: 'pnpm',
    args: [
      '--filter',
      '@tearleads/api',
      'test',
      '--',
      'src/routes/vfs-rekey.test.ts',
      'src/routes/vfs/post-crdt-push-parse.encrypted.test.ts'
    ]
  },
  {
    id: 'api-client-crypto',
    description:
      'API-client secure pipeline and rekey client contracts are intact',
    command: 'pnpm',
    args: [
      '--filter',
      '@tearleads/api-client',
      'test',
      '--',
      'src/vfsCrypto/secureWritePipelineFactory.test.ts',
      'src/vfsCrypto/rekeyClient.test.ts'
    ]
  },
  {
    id: 'client-secure-upload',
    description:
      'Client secure upload fail-closed behavior and local large-file paths are verified',
    command: 'pnpm',
    args: [
      '--filter',
      '@tearleads/client',
      'test',
      '--',
      'src/hooks/vfs/useFileUpload.vfsRegistration.test.ts',
      'src/hooks/vfs/useFileUpload.fileTypeAndEnvironment.test.ts',
      'src/storage/opfs/CapacitorStorage.test.ts',
      'src/contexts/ClientVfsExplorerProvider.test.tsx'
    ]
  },
  {
    id: 'vfs-sync-guardrail',
    description:
      'Sync client fail-closed behavior for encrypted envelope unsupported contract remains deterministic',
    command: 'pnpm',
    args: [
      '--filter',
      '@tearleads/vfs-sync',
      'test',
      '--',
      'src/vfs/sync-client-shard-03.test.ts',
      'src/vfs/sync-http-transport-parser.test.ts'
    ]
  }
];

async function runCheck(check: Check): Promise<CheckResult> {
  const start = Date.now();
  const exitCode = await new Promise<number>((resolve) => {
    const child = spawn(check.command, check.args, {
      stdio: 'inherit',
      shell: false
    });

    child.on('error', () => resolve(1));
    child.on('close', (code) => resolve(code ?? 1));
  });

  return {
    check,
    success: exitCode === 0,
    durationMs: Date.now() - start
  };
}

function formatDuration(ms: number): string {
  const seconds = (ms / 1000).toFixed(1);
  return `${seconds}s`;
}

async function main(): Promise<void> {
  const startedAt = new Date();
  const results: CheckResult[] = [];

  console.log('VFS secure upload readiness checks');
  console.log(`Started: ${startedAt.toISOString()}`);
  console.log('');

  for (const check of CHECKS) {
    console.log(`[${check.id}] ${check.description}`);
    const result = await runCheck(check);
    results.push(result);
    const status = result.success ? 'PASS' : 'FAIL';
    console.log(
      `Result: ${status} (${formatDuration(result.durationMs)}) for ${check.id}`
    );
    console.log('');

    if (!result.success) {
      break;
    }
  }

  const completedAt = new Date();
  const passed = results.filter((result) => result.success).length;
  const failed = results.length - passed;

  console.log('Summary');
  console.log(`Completed: ${completedAt.toISOString()}`);
  console.log(`Checks run: ${results.length}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log('');

  for (const result of results) {
    console.log(
      `- ${result.check.id}: ${result.success ? 'PASS' : 'FAIL'} (${formatDuration(
        result.durationMs
      )})`
    );
  }

  if (failed > 0) {
    process.exit(1);
  }
}

void main();
