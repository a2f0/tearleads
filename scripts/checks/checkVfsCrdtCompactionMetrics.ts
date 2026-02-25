#!/usr/bin/env -S pnpm exec tsx
import fs from 'node:fs/promises';
import process from 'node:process';

type Args = {
  file: string | null;
  strict: boolean;
  requireMetric: boolean;
  json: boolean;
};

type CheckSummary = {
  scannedLines: number;
  metricLines: number;
  validMetricLines: number;
  invalidMetricLines: number;
  parseErrors: number;
  errors: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isVfsCrdtCompactionRunMetric(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  const metricVersion = value['metricVersion'];
  const event = value['event'];
  const occurredAt = value['occurredAt'];
  const success = value['success'];
  const executed = value['executed'];
  const durationMs = value['durationMs'];
  const cutoffOccurredAt = value['cutoffOccurredAt'];
  const estimatedRowsToDelete = value['estimatedRowsToDelete'];
  const deletedRows = value['deletedRows'];
  const activeClientCount = value['activeClientCount'];
  const staleClientCount = value['staleClientCount'];
  const staleClientIds = value['staleClientIds'];
  const staleClientIdsTruncatedCount = value['staleClientIdsTruncatedCount'];
  const malformedClientStateCount = value['malformedClientStateCount'];
  const blockedReason = value['blockedReason'];
  const error = value['error'];

  if (metricVersion !== 1 || event !== 'vfs_crdt_compaction_run') {
    return false;
  }

  if (
    typeof occurredAt !== 'string' ||
    !Number.isFinite(Date.parse(occurredAt))
  ) {
    return false;
  }

  if (typeof success !== 'boolean' || typeof executed !== 'boolean') {
    return false;
  }

  if (
    typeof durationMs !== 'number' ||
    !Number.isFinite(durationMs) ||
    durationMs < 0
  ) {
    return false;
  }

  if (
    cutoffOccurredAt !== null &&
    (typeof cutoffOccurredAt !== 'string' ||
      !Number.isFinite(Date.parse(cutoffOccurredAt)))
  ) {
    return false;
  }

  if (
    typeof estimatedRowsToDelete !== 'number' ||
    !Number.isFinite(estimatedRowsToDelete) ||
    estimatedRowsToDelete < 0
  ) {
    return false;
  }

  if (
    typeof deletedRows !== 'number' ||
    !Number.isFinite(deletedRows) ||
    deletedRows < 0
  ) {
    return false;
  }

  if (
    typeof activeClientCount !== 'number' ||
    !Number.isFinite(activeClientCount) ||
    activeClientCount < 0
  ) {
    return false;
  }

  if (
    typeof staleClientCount !== 'number' ||
    !Number.isFinite(staleClientCount) ||
    staleClientCount < 0
  ) {
    return false;
  }

  if (
    !Array.isArray(staleClientIds) ||
    staleClientIds.some((entry) => typeof entry !== 'string')
  ) {
    return false;
  }

  if (
    typeof staleClientIdsTruncatedCount !== 'number' ||
    !Number.isFinite(staleClientIdsTruncatedCount) ||
    staleClientIdsTruncatedCount < 0
  ) {
    return false;
  }

  if (
    typeof malformedClientStateCount !== 'number' ||
    !Number.isFinite(malformedClientStateCount) ||
    malformedClientStateCount < 0
  ) {
    return false;
  }

  if (blockedReason !== null && blockedReason !== 'malformedClientState') {
    return false;
  }

  if (error !== null && typeof error !== 'string') {
    return false;
  }

  return true;
}

function parseArgs(argv: string[]): Args {
  let file: string | null = null;
  let strict = false;
  let requireMetric = true;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) {
      continue;
    }

    if (arg === '--strict') {
      strict = true;
      continue;
    }

    if (arg === '--json') {
      json = true;
      continue;
    }

    if (arg === '--allow-no-metric') {
      requireMetric = false;
      continue;
    }

    if (arg === '--file') {
      const next = argv[index + 1];
      if (!next) {
        throw new Error('--file requires a value');
      }
      file = next;
      index += 1;
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return {
    file,
    strict,
    requireMetric,
    json
  };
}

function printUsage(): void {
  console.log('Usage: checkVfsCrdtCompactionMetrics.ts [options]');
  console.log('');
  console.log('Options:');
  console.log('  --file <path>       Read logs from file (default: stdin)');
  console.log(
    '  --strict            Exit non-zero on parse errors for JSON lines'
  );
  console.log('  --json              Print summary as JSON');
  console.log(
    '  --allow-no-metric   Allow runs with zero compaction metric events'
  );
  console.log('  -h, --help          Show usage');
}

async function readInput(file: string | null): Promise<string> {
  if (file) {
    return fs.readFile(file, 'utf8');
  }

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }

  return Buffer.concat(chunks).toString('utf8');
}

function checkContent(content: string, args: Args): CheckSummary {
  const lines = content.split(/\r?\n/u);
  const errors: string[] = [];

  let scannedLines = 0;
  let metricLines = 0;
  let validMetricLines = 0;
  let invalidMetricLines = 0;
  let parseErrors = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]?.trim() ?? '';
    if (line.length === 0) {
      continue;
    }

    scannedLines += 1;

    if (!(line.startsWith('{') && line.endsWith('}'))) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      parseErrors += 1;
      if (args.strict) {
        errors.push(`Line ${i + 1}: invalid JSON object line`);
      }
      continue;
    }

    if (typeof parsed !== 'object' || parsed === null) {
      continue;
    }

    const event = Reflect.get(parsed, 'event');
    if (event !== 'vfs_crdt_compaction_run') {
      continue;
    }

    metricLines += 1;
    if (isVfsCrdtCompactionRunMetric(parsed)) {
      validMetricLines += 1;
    } else {
      invalidMetricLines += 1;
      errors.push(`Line ${i + 1}: invalid vfs_crdt_compaction_run schema`);
    }
  }

  if (args.requireMetric && metricLines === 0) {
    errors.push('No vfs_crdt_compaction_run metric event found');
  }

  return {
    scannedLines,
    metricLines,
    validMetricLines,
    invalidMetricLines,
    parseErrors,
    errors
  };
}

function printSummary(summary: CheckSummary, asJson: boolean): void {
  if (asJson) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log('VFS CRDT compaction metric check');
  console.log('===============================');
  console.log(`scannedLines: ${summary.scannedLines}`);
  console.log(`metricLines: ${summary.metricLines}`);
  console.log(`validMetricLines: ${summary.validMetricLines}`);
  console.log(`invalidMetricLines: ${summary.invalidMetricLines}`);
  console.log(`parseErrors: ${summary.parseErrors}`);

  if (summary.errors.length > 0) {
    console.log('errors:');
    for (const error of summary.errors) {
      console.log(`- ${error}`);
    }
  }
}

async function main(): Promise<void> {
  try {
    const args = parseArgs(process.argv.slice(2));
    const content = await readInput(args.file);
    const summary = checkContent(content, args);

    printSummary(summary, args.json);

    if (summary.errors.length > 0) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

await main();
