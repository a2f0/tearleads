import { describe, expect, it } from 'vitest';
import {
  CHECKS,
  type Check,
  formatMarkdownReport,
  parseCliOptions,
  resolveCandidateSha,
  runQaSuiteChecks
} from './vfsSecureUploadQaSuite.js';

describe('vfsSecureUploadQaSuite', () => {
  it('parses CLI flags for dry-run and report outputs', () => {
    const options = parseCliOptions([
      'node',
      'qa-suite',
      '--dry-run',
      '--continue-on-failure',
      '--report-json',
      'coverage/qa/report.json',
      '--report-markdown',
      'coverage/qa/report.md'
    ]);

    expect(options).toEqual({
      dryRun: true,
      continueOnFailure: true,
      reportJsonPath: 'coverage/qa/report.json',
      reportMarkdownPath: 'coverage/qa/report.md'
    });
  });

  it('prefers GITHUB_SHA candidate and falls back to git SHA then unknown', () => {
    expect(resolveCandidateSha('env-sha-1')).toBe('env-sha-1');
    expect(resolveCandidateSha(undefined, () => 'git-sha-1')).toBe('git-sha-1');
    expect(resolveCandidateSha(undefined, () => null)).toBe('unknown');
  });

  it('produces skipped QA suite report during dry-run', async () => {
    const logs: string[] = [];
    const checkCalls: Check[] = [];

    const { report } = await runQaSuiteChecks(
      {
        dryRun: true,
        continueOnFailure: false,
        reportJsonPath: 'coverage/qa/vfsSecureUploadQaSuite.json',
        reportMarkdownPath: 'coverage/qa/vfsSecureUploadQaSuite.md'
      },
      'sha-123',
      async (check) => {
        checkCalls.push(check);
        return { check, status: 'pass', durationMs: 5 };
      },
      (line) => {
        logs.push(line);
      }
    );

    expect(checkCalls).toHaveLength(0);
    expect(report.command).toBe('pnpm qaVfsSecureUploadTestEvidence');
    expect(report.candidateSha).toBe('sha-123');
    expect(report.checksRun).toBe(CHECKS.length);
    expect(report.skipped).toBe(CHECKS.length);
    expect(report.failed).toBe(0);
    expect(report.checks.every((check) => check.status === 'skipped')).toBe(
      true
    );
    expect(logs.join('\n')).toContain('Dry run: yes');
  });

  it('stops on first failure unless continue-on-failure is enabled', async () => {
    const executor = async (check: Check) => {
      if (check.id === CHECKS[0]?.id) {
        return { check, status: 'fail' as const, durationMs: 10 };
      }
      return { check, status: 'pass' as const, durationMs: 10 };
    };

    const stopResult = await runQaSuiteChecks(
      {
        dryRun: false,
        continueOnFailure: false,
        reportJsonPath: null,
        reportMarkdownPath: null
      },
      'sha-stop',
      executor
    );
    expect(stopResult.results).toHaveLength(1);
    expect(stopResult.report.failed).toBe(1);

    const continueResult = await runQaSuiteChecks(
      {
        dryRun: false,
        continueOnFailure: true,
        reportJsonPath: null,
        reportMarkdownPath: null
      },
      'sha-continue',
      executor
    );
    expect(continueResult.results).toHaveLength(CHECKS.length);
    expect(continueResult.report.failed).toBe(1);
  });

  it('renders markdown report with sign-off section', () => {
    const markdown = formatMarkdownReport({
      command: 'pnpm qaVfsSecureUploadTestEvidence',
      candidateSha: 'sha-md',
      startedAt: '2026-02-24T00:00:00.000Z',
      completedAt: '2026-02-24T00:00:01.000Z',
      dryRun: true,
      checksRun: 1,
      passed: 0,
      failed: 0,
      skipped: 1,
      allPassed: true,
      checks: [
        {
          id: 'api-rekey-crdt',
          description: 'desc',
          command: 'pnpm',
          args: ['test'],
          status: 'skipped',
          durationMs: 0
        }
      ]
    });

    expect(markdown).toContain('# VFS Secure Upload QA Suite Report');
    expect(markdown).toContain('| `api-rekey-crdt` | SKIP |');
    expect(markdown).toContain('## Sign-off Fields');
  });
});
