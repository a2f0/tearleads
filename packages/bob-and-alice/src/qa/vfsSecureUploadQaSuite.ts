import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export type Check = {
  id: string;
  description: string;
  command: string;
  args: string[];
};

export type CheckStatus = 'pass' | 'fail' | 'skipped';

export type CheckResult = {
  check: Check;
  status: CheckStatus;
  durationMs: number;
};

export interface CliOptions {
  dryRun: boolean;
  continueOnFailure: boolean;
  reportJsonPath: string | null;
  reportMarkdownPath: string | null;
}

export interface QaSuiteReport {
  command: string;
  candidateSha: string;
  startedAt: string;
  completedAt: string;
  dryRun: boolean;
  checksRun: number;
  passed: number;
  failed: number;
  skipped: number;
  allPassed: boolean;
  checks: Array<{
    id: string;
    description: string;
    command: string;
    args: string[];
    status: CheckStatus;
    durationMs: number;
  }>;
}

export const CHECKS: Check[] = [
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
      'src/vfsCrypto/secureWritePipelineRuntime.streaming.test.ts',
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
      'src/hooks/vfs/useFileUpload.vfsSecureStreaming.test.ts',
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

export function parseCliOptions(argv: string[]): CliOptions {
  const args = argv.slice(2);
  let dryRun = false;
  let continueOnFailure = false;
  let reportJsonPath: string | null = null;
  let reportMarkdownPath: string | null = null;

  while (args.length > 0) {
    const token = args.shift();
    if (!token) {
      continue;
    }

    switch (token) {
      case '--dry-run':
        dryRun = true;
        break;
      case '--continue-on-failure':
        continueOnFailure = true;
        break;
      case '--report-json':
        if (args.length > 0 && !args[0]?.startsWith('--')) {
          reportJsonPath = args.shift() ?? null;
        }
        break;
      case '--report-markdown':
        if (args.length > 0 && !args[0]?.startsWith('--')) {
          reportMarkdownPath = args.shift() ?? null;
        }
        break;
    }
  }

  return {
    dryRun,
    continueOnFailure,
    reportJsonPath,
    reportMarkdownPath
  };
}

export function formatDuration(ms: number): string {
  const seconds = (ms / 1000).toFixed(1);
  return `${seconds}s`;
}

export function resolveCandidateSha(
  envSha: string | undefined,
  getHeadSha: () => string | null = () => {
    const gitResult = spawnSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    if (gitResult.status === 0 && typeof gitResult.stdout === 'string') {
      const value = gitResult.stdout.trim();
      if (value.length > 0) {
        return value;
      }
    }
    return null;
  }
): string {
  if (typeof envSha === 'string' && envSha.length > 0) {
    return envSha;
  }

  const gitSha = getHeadSha();
  if (typeof gitSha === 'string' && gitSha.length > 0) {
    return gitSha;
  }

  return 'unknown';
}

export function buildReport(
  options: CliOptions,
  candidateSha: string,
  startedAt: Date,
  completedAt: Date,
  results: CheckResult[]
): QaSuiteReport {
  const passed = results.filter((result) => result.status === 'pass').length;
  const failed = results.filter((result) => result.status === 'fail').length;
  const skipped = results.filter(
    (result) => result.status === 'skipped'
  ).length;

  return {
    command:
      options.reportJsonPath || options.reportMarkdownPath
        ? 'pnpm qaVfsSecureUploadTestEvidence'
        : 'pnpm qaVfsSecureUploadTestSuite',
    candidateSha,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    dryRun: options.dryRun,
    checksRun: results.length,
    passed,
    failed,
    skipped,
    allPassed: failed === 0,
    checks: results.map((result) => ({
      id: result.check.id,
      description: result.check.description,
      command: result.check.command,
      args: result.check.args,
      status: result.status,
      durationMs: result.durationMs
    }))
  };
}

export function formatMarkdownReport(report: QaSuiteReport): string {
  const lines: string[] = [
    '# VFS Secure Upload QA Suite Report',
    '',
    `- Candidate SHA: \`${report.candidateSha}\``,
    `- Command: \`${report.command}\``,
    `- Started: ${report.startedAt}`,
    `- Completed: ${report.completedAt}`,
    `- Dry run: ${report.dryRun ? 'yes' : 'no'}`,
    `- Passed: ${report.passed}`,
    `- Failed: ${report.failed}`,
    `- Skipped: ${report.skipped}`,
    '',
    '## Checks',
    '',
    '| Check | Status | Duration |',
    '| --- | --- | --- |'
  ];

  for (const check of report.checks) {
    const icon =
      check.status === 'pass'
        ? 'PASS'
        : check.status === 'fail'
          ? 'FAIL'
          : 'SKIP';
    lines.push(
      `| \`${check.id}\` | ${icon} | ${formatDuration(check.durationMs)} |`
    );
  }

  lines.push('', '## Sign-off Fields', '');
  lines.push('- Staging successful secure upload evidence link:');
  lines.push('- Staging forced-failure secure upload evidence link:');
  lines.push('- Rollback owner:');
  lines.push('- Promotion decision owner + timestamp:');
  lines.push('');

  return lines.join('\n');
}

export function writeReportFile(pathValue: string, content: string): void {
  const absolute = resolve(pathValue);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, 'utf8');
}

export type CheckExecutor = (check: Check) => Promise<CheckResult>;

export async function runCheck(check: Check): Promise<CheckResult> {
  const start = Date.now();
  const exitCode = await new Promise<number>((resolveCode) => {
    const child = spawn(check.command, check.args, {
      stdio: 'inherit',
      shell: false
    });

    child.on('error', () => resolveCode(1));
    child.on('close', (code) => resolveCode(code ?? 1));
  });

  return {
    check,
    status: exitCode === 0 ? 'pass' : 'fail',
    durationMs: Date.now() - start
  };
}

export interface RunQaSuiteResult {
  report: QaSuiteReport;
  results: CheckResult[];
}

export async function runQaSuiteChecks(
  options: CliOptions,
  candidateSha: string,
  executeCheck: CheckExecutor = runCheck,
  log: (message: string) => void = (message) => {
    console.log(message);
  }
): Promise<RunQaSuiteResult> {
  const startedAt = new Date();
  const results: CheckResult[] = [];

  log('VFS secure upload QA suite checks');
  log(`Candidate SHA: ${candidateSha}`);
  log(`Started: ${startedAt.toISOString()}`);
  log(`Dry run: ${options.dryRun ? 'yes' : 'no'}`);
  log('');

  for (const check of CHECKS) {
    log(`[${check.id}] ${check.description}`);

    let result: CheckResult;
    if (options.dryRun) {
      result = {
        check,
        status: 'skipped',
        durationMs: 0
      };
    } else {
      result = await executeCheck(check);
    }

    results.push(result);
    const status =
      result.status === 'pass'
        ? 'PASS'
        : result.status === 'fail'
          ? 'FAIL'
          : 'SKIP';
    log(
      `Result: ${status} (${formatDuration(result.durationMs)}) for ${check.id}`
    );
    log('');

    if (result.status === 'fail' && !options.continueOnFailure) {
      break;
    }
  }

  const completedAt = new Date();
  const report = buildReport(
    options,
    candidateSha,
    startedAt,
    completedAt,
    results
  );

  log('Summary');
  log(`Completed: ${completedAt.toISOString()}`);
  log(`Checks run: ${report.checksRun}`);
  log(`Passed: ${report.passed}`);
  log(`Failed: ${report.failed}`);
  log(`Skipped: ${report.skipped}`);
  log('');

  for (const result of results) {
    const status =
      result.status === 'pass'
        ? 'PASS'
        : result.status === 'fail'
          ? 'FAIL'
          : 'SKIP';
    log(
      `- ${result.check.id}: ${status} (${formatDuration(result.durationMs)})`
    );
  }

  return { report, results };
}
