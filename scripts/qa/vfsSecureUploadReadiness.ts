#!/usr/bin/env tsx
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

type Check = {
  id: string;
  description: string;
  command: string;
  args: string[];
};

type CheckResult = {
  check: Check;
  status: 'pass' | 'fail' | 'skipped';
  durationMs: number;
};

interface CliOptions {
  dryRun: boolean;
  continueOnFailure: boolean;
  reportJsonPath: string | null;
  reportMarkdownPath: string | null;
}

interface ReadinessReport {
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
    status: 'pass' | 'fail' | 'skipped';
    durationMs: number;
  }>;
}

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

function parseCliOptions(argv: string[]): CliOptions {
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
    status: exitCode === 0 ? 'pass' : 'fail',
    durationMs: Date.now() - start
  };
}

function formatDuration(ms: number): string {
  const seconds = (ms / 1000).toFixed(1);
  return `${seconds}s`;
}

function resolveCandidateSha(): string {
  const envSha = process.env['GITHUB_SHA'];
  if (typeof envSha === 'string' && envSha.length > 0) {
    return envSha;
  }

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

  return 'unknown';
}

function buildReport(
  options: CliOptions,
  candidateSha: string,
  startedAt: Date,
  completedAt: Date,
  results: CheckResult[]
): ReadinessReport {
  const passed = results.filter((result) => result.status === 'pass').length;
  const failed = results.filter((result) => result.status === 'fail').length;
  const skipped = results.filter(
    (result) => result.status === 'skipped'
  ).length;

  return {
    command:
      options.reportJsonPath || options.reportMarkdownPath
        ? 'pnpm qaVfsSecureUploadEvidence'
        : 'pnpm qaVfsSecureUpload',
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

function formatMarkdownReport(report: ReadinessReport): string {
  const lines: string[] = [
    '# VFS Secure Upload Readiness Report',
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

function writeReportFile(pathValue: string, content: string): void {
  const absolute = resolve(pathValue);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, 'utf8');
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv);
  const candidateSha = resolveCandidateSha();
  const startedAt = new Date();
  const results: CheckResult[] = [];

  console.log('VFS secure upload readiness checks');
  console.log(`Candidate SHA: ${candidateSha}`);
  console.log(`Started: ${startedAt.toISOString()}`);
  console.log(`Dry run: ${options.dryRun ? 'yes' : 'no'}`);
  console.log('');

  for (const check of CHECKS) {
    console.log(`[${check.id}] ${check.description}`);
    const result = options.dryRun
      ? {
          check,
          status: 'skipped' as const,
          durationMs: 0
        }
      : await runCheck(check);
    results.push(result);
    const status =
      result.status === 'pass'
        ? 'PASS'
        : result.status === 'fail'
          ? 'FAIL'
          : 'SKIP';
    console.log(
      `Result: ${status} (${formatDuration(result.durationMs)}) for ${check.id}`
    );
    console.log('');

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

  console.log('Summary');
  console.log(`Completed: ${completedAt.toISOString()}`);
  console.log(`Checks run: ${report.checksRun}`);
  console.log(`Passed: ${report.passed}`);
  console.log(`Failed: ${report.failed}`);
  console.log(`Skipped: ${report.skipped}`);
  console.log('');

  for (const result of results) {
    console.log(
      `- ${result.check.id}: ${
        result.status === 'pass'
          ? 'PASS'
          : result.status === 'fail'
            ? 'FAIL'
            : 'SKIP'
      } (${formatDuration(result.durationMs)})`
    );
  }

  if (options.reportJsonPath) {
    writeReportFile(
      options.reportJsonPath,
      `${JSON.stringify(report, null, 2)}\n`
    );
    console.log(`JSON report written: ${resolve(options.reportJsonPath)}`);
  }
  if (options.reportMarkdownPath) {
    writeReportFile(options.reportMarkdownPath, formatMarkdownReport(report));
    console.log(
      `Markdown report written: ${resolve(options.reportMarkdownPath)}`
    );
  }

  if (!options.dryRun && report.failed > 0) {
    process.exit(1);
  }
}

void main();
