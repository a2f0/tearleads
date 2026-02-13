#!/usr/bin/env -S pnpm exec tsx
import { execSync, spawnSync } from 'node:child_process';

interface CliArgs {
  base?: string;
  head?: string;
  files?: string;
  dryRun: boolean;
}

interface CiImpactJobs {
  build: { run: boolean; reasons: string[] };
}

interface CiImpactOutput {
  changedFiles: string[];
  materialFiles: string[];
  changedPackages: string[];
  affectedPackages: string[];
  jobs: CiImpactJobs;
}

const DEFAULT_BASE = 'origin/main';
const DEFAULT_HEAD = 'HEAD';

const COVERAGE_PACKAGES: ReadonlyArray<string> = [
  '@tearleads/shared',
  '@tearleads/ui',
  '@tearleads/api',
  '@tearleads/client',
  '@tearleads/chrome-extension',
  '@tearleads/website'
];

const FULL_RUN_FILE_NAMES: ReadonlyArray<string> = ['pnpm-lock.yaml', 'pnpm-workspace.yaml', 'package.json'];
const FULL_RUN_PREFIXES: ReadonlyArray<string> = [
  '.github/actions/',
  'scripts/ciImpact/',
  '.github/workflows/build.yml',
  '.github/workflows/ci-gate.yml',
  '.github/workflows/integration-deploy.yml',
  '.github/workflows/web-e2e.yml',
  '.github/workflows/website-e2e.yml',
  '.github/workflows/electron-e2e.yml',
  '.github/workflows/android.yml',
  '.github/workflows/android-maestro-release.yml',
  '.github/workflows/ios-maestro-release.yml'
];

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { dryRun: false };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (!token.startsWith('--')) {
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      continue;
    }
    if (key === 'base') {
      args.base = next;
    } else if (key === 'head') {
      args.head = next;
    } else if (key === 'files') {
      args.files = next;
    }
    i += 1;
  }
  return args;
}

function readStringArray(obj: object, key: string): string[] {
  const raw = Reflect.get(obj, key);
  if (!Array.isArray(raw)) {
    return [];
  }

  const out: string[] = [];
  for (const item of raw) {
    if (typeof item === 'string') {
      out.push(item);
    }
  }
  return out;
}

function parseImpact(rawJson: string): CiImpactOutput {
  const parsed = JSON.parse(rawJson);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Invalid ciImpact output');
  }

  const jobsRaw = Reflect.get(parsed, 'jobs');
  if (typeof jobsRaw !== 'object' || jobsRaw === null) {
    throw new Error('Invalid ciImpact output.jobs');
  }

  const buildRaw = Reflect.get(jobsRaw, 'build');
  if (typeof buildRaw !== 'object' || buildRaw === null) {
    throw new Error('Invalid ciImpact output.jobs.build');
  }

  const buildRun = Reflect.get(buildRaw, 'run');
  const buildReasons = readStringArray(buildRaw, 'reasons');
  if (typeof buildRun !== 'boolean') {
    throw new Error('Invalid ciImpact output.jobs.build.run');
  }

  return {
    changedFiles: readStringArray(parsed, 'changedFiles'),
    materialFiles: readStringArray(parsed, 'materialFiles'),
    changedPackages: readStringArray(parsed, 'changedPackages'),
    affectedPackages: readStringArray(parsed, 'affectedPackages'),
    jobs: {
      build: {
        run: buildRun,
        reasons: buildReasons
      }
    }
  };
}

function runCiImpact(args: CliArgs): CiImpactOutput {
  const base = args.base || DEFAULT_BASE;
  const head = args.head || DEFAULT_HEAD;
  const parts = ['pnpm exec tsx scripts/ciImpact/ciImpact.ts', `--base ${base}`, `--head ${head}`];
  if (args.files !== undefined) {
    parts.push(`--files "${args.files}"`);
  }
  const cmd = parts.join(' ');
  const output = execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return parseImpact(output);
}

function requiresFullCoverageRun(changedFiles: string[]): boolean {
  for (const file of changedFiles) {
    if (FULL_RUN_FILE_NAMES.includes(file)) {
      return true;
    }
    for (const prefix of FULL_RUN_PREFIXES) {
      if (file.startsWith(prefix)) {
        return true;
      }
    }
  }
  return false;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function runCoverageForPackage(pkg: string): void {
  const result = spawnSync('pnpm', ['--filter', pkg, 'test:coverage'], {
    stdio: 'inherit',
    env: process.env
  });

  if (typeof result.status === 'number' && result.status !== 0) {
    process.exit(result.status);
  }

  if (result.status === null) {
    process.exit(1);
  }
}

function main(): void {
  const args = parseArgs(process.argv);
  const impact = runCiImpact(args);

  const affectedSet = new Set(impact.affectedPackages);
  const fullRun = requiresFullCoverageRun(impact.changedFiles);

  let targets: string[] = [];
  if (fullRun) {
    targets = [...COVERAGE_PACKAGES];
  } else {
    targets = COVERAGE_PACKAGES.filter((pkg) => affectedSet.has(pkg));
  }

  targets = uniqueSorted(targets);

  if (impact.materialFiles.length === 0) {
    console.log('ci-impact: no material changes, skipping coverage tests.');
    return;
  }

  if (targets.length === 0) {
    console.log('ci-impact: no impacted coverage packages, skipping coverage tests.');
    return;
  }

  if (fullRun) {
    console.log('ci-impact: running full coverage package set due to high-risk file changes.');
  } else {
    console.log('ci-impact: running impacted coverage packages only.');
  }
  console.log(`ci-impact: targets => ${targets.join(', ')}`);

  if (args.dryRun) {
    return;
  }

  for (const pkg of targets) {
    runCoverageForPackage(pkg);
  }
}

main();
