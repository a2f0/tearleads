import { spawn, spawnSync } from 'node:child_process';

export type Check = {
  id: string;
  description: string;
  command: string;
  args: string[];
};

type CheckStatus = 'pass' | 'fail' | 'skipped';

type CheckResult = {
  check: Check;
  status: CheckStatus;
  durationMs: number;
};

interface CliOptions {
  dryRun: boolean;
  continueOnFailure: boolean;
  reportJsonPath: string | null;
  reportMarkdownPath: string | null;
}

interface QaSuiteReport {
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
    id: 'api-crdt-core',
    description:
      'CRDT push/sync/session/snapshot core behavior remains deterministic',
    command: 'pnpm',
    args: [
      '--filter',
      '@tearleads/api',
      'test',
      '--',
      'src/routes/vfs/crdtPushProcessing.test.ts',
      'src/routes/vfs/crdtSyncReplicaFallback.test.ts',
      'src/routes/vfs/crdtSession.test.ts',
      'src/lib/vfsCrdtSnapshots.test.ts'
    ]
  },
  {
    id: 'api-crdt-blob-guardrails',
    description:
      'Blob attach visibility, chunk commit, and Redis upload-session guardrails are enforced',
    command: 'pnpm',
    args: [
      '--filter',
      '@tearleads/api',
      'test',
      '--',
      'src/routes/vfs/blobsAttachVisibility.test.ts',
      'src/routes/vfs/blobsChunkCommit.test.ts',
      'src/routes/vfs/blobUploadSessions.test.ts'
    ]
  },
  {
    id: 'api-crdt-rollout-flags',
    description:
      'CRDT rollout fallback/rollback controls and parity checks remain covered',
    command: 'pnpm',
    args: [
      '--filter',
      '@tearleads/api',
      'test',
      '--',
      'src/lib/vfsCrdtReplicaWriteIds.test.ts',
      'src/lib/vfsCrdtReplicaHeadsParity.test.ts',
      'src/routes/vfs/crdtEnvelopeReadOptions.test.ts',
      'src/routes/vfs/crdtEnvelopeStorage.test.ts'
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

function formatDuration(ms: number): string {
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

function buildReport(
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
    command: 'pnpm testVfsCrdtRolloutQaSuite',
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
    '# VFS CRDT Rollout QA Suite Report',
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
  lines.push('- Staging baseline perf log artifact:');
  lines.push('- Staging candidate perf log artifact:');
  lines.push(
    '- Perf gate command: `pnpm checkVfsCrdtRoutePerfMetrics --baseline-file <baseline.log> --candidate-file <candidate.log>`'
  );
  lines.push('- QA owner + timestamp:');
  lines.push('');

  return lines.join('\n');
}

type CheckExecutor = (check: Check) => Promise<CheckResult>;

async function runCheck(check: Check): Promise<CheckResult> {
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

interface RunQaSuiteResult {
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

  log('VFS CRDT rollout QA suite checks');
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

  return { report, results };
}
