import fs from 'node:fs';

export interface KnipIssue {
  severity: string;
  workspace: string;
  file: string;
  issueType: string;
}

export interface CliOptions {
  json: boolean;
}

export interface KnipSummaryResult {
  totals: {
    issues: number;
    errors: number;
    warnings: number;
  };
  byIssueType: Record<string, number>;
  byWorkspace: Record<string, number>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseArgs(argv: string[]): CliOptions {
  return {
    json: argv.includes('--json')
  };
}

function readStdin(): string {
  return fs.readFileSync(0, 'utf8');
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('Invalid JSON input for knip strict summary');
  }
}

export function parseKnipIssues(parsed: unknown): KnipIssue[] {
  if (!isRecord(parsed)) {
    return [];
  }

  const issuesRaw = parsed.issues;
  if (!Array.isArray(issuesRaw)) {
    return [];
  }

  const issues: KnipIssue[] = [];
  for (const issue of issuesRaw) {
    if (!isRecord(issue)) {
      continue;
    }

    const severity = typeof issue.severity === 'string' ? issue.severity : 'unknown';
    const workspace = typeof issue.workspace === 'string' ? issue.workspace : 'unknown';
    const file = typeof issue.file === 'string' ? issue.file : 'unknown';
    const issueType = typeof issue.issueType === 'string' ? issue.issueType : 'unknown';

    issues.push({ severity, workspace, file, issueType });
  }

  return issues;
}

export function summarizeKnipIssues(issues: KnipIssue[]): KnipSummaryResult {
  const byIssueType: Record<string, number> = {};
  const byWorkspace: Record<string, number> = {};
  let errors = 0;
  let warnings = 0;

  for (const issue of issues) {
    byIssueType[issue.issueType] = (byIssueType[issue.issueType] ?? 0) + 1;
    byWorkspace[issue.workspace] = (byWorkspace[issue.workspace] ?? 0) + 1;

    if (issue.severity === 'error') {
      errors += 1;
    } else if (issue.severity === 'warn' || issue.severity === 'warning') {
      warnings += 1;
    }
  }

  return {
    totals: {
      issues: issues.length,
      errors,
      warnings
    },
    byIssueType,
    byWorkspace
  };
}

export function renderKnipSummary(result: KnipSummaryResult): string {
  const lines: string[] = [];
  lines.push('Knip Strict Summary');
  lines.push(`- Issues: ${result.totals.issues}`);
  lines.push(`- Errors: ${result.totals.errors}`);
  lines.push(`- Warnings: ${result.totals.warnings}`);

  if (Object.keys(result.byIssueType).length === 0) {
    lines.push('- By issue type: none');
  } else {
    lines.push('- By issue type:');
    for (const [type, count] of Object.entries(result.byIssueType)) {
      lines.push(`  ${type}: ${count}`);
    }
  }

  if (Object.keys(result.byWorkspace).length === 0) {
    lines.push('- By workspace: none');
  } else {
    lines.push('- By workspace:');
    for (const [workspace, count] of Object.entries(result.byWorkspace)) {
      lines.push(`  ${workspace}: ${count}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

function main(): number {
  const options = parseArgs(process.argv.slice(2));
  const parsed = parseJson(readStdin());
  const result = summarizeKnipIssues(parseKnipIssues(parsed));

  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  }

  process.stdout.write(renderKnipSummary(result));
  return 0;
}

if (import.meta.main) {
  try {
    process.exitCode = main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
