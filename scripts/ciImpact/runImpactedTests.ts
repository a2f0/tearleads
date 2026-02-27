#!/usr/bin/env -S pnpm exec tsx
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { runCoverageForPackage } from './coverageRunner.ts';

interface CliArgs {
  base?: string;
  head?: string;
  files?: string;
  dryRun: boolean;
  scriptsOnly: boolean;
  printTargetsJson: boolean;
}

interface CiImpactJobs {
  build: { run: boolean; reasons: string[] };
}

interface CiImpactOutput {
  changedFiles: string[];
  materialFiles: string[];
  changedPackages: string[];
  affectedPackages: string[];
  warnings: string[];
  jobs: CiImpactJobs;
}

const DEFAULT_BASE = 'origin/main';
const DEFAULT_HEAD = 'HEAD';

interface PackageJsonShape {
  name?: string;
  scripts?: Record<string, string>;
}

interface WorkspacePackage {
  name: string;
  hasCoverageScript: boolean;
}

const FULL_RUN_FILE_NAMES: ReadonlyArray<string> = [
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'package.json',
  'tsconfig.json',
  'tsconfig.base.json',
  'scripts/tsconfig.json',
  'scripts/tsconfig.test.json'
];
const FULL_RUN_PREFIXES: ReadonlyArray<string> = [
  '.github/actions/',
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
const FULL_RUN_EXACT_EXCEPTIONS: ReadonlyArray<string> = [
  '.github/workflows/build.yml'
];
const CI_IMPACT_SCRIPT_TEST_PREFIXES: ReadonlyArray<string> = [
  'scripts/ciImpact/',
  'scripts/agents/tooling/'
];
const CI_IMPACT_SCRIPT_TEST_REGEX =
  /^(?:scripts\/ciImpact\/|scripts\/agents\/tooling\/)/;
const CI_IMPACT_SCRIPT_TEST_FILES: ReadonlyArray<string> = [
  'scripts/ciImpact/ciImpact.test.ts',
  'scripts/ciImpact/requiredWorkflows.test.ts',
  'scripts/agents/tooling/agentTool.test.ts'
];

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    dryRun: false,
    scriptsOnly: false,
    printTargetsJson: false
  };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === undefined) {
      continue;
    }
    if (token === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (token === '--scripts-only') {
      args.scriptsOnly = true;
      continue;
    }
    if (token === '--print-targets-json') {
      args.printTargetsJson = true;
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
    warnings: readStringArray(parsed, 'warnings'),
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
  const ciImpactScript = 'scripts/ciImpact/ciImpact.ts';
  const ciImpactArgs = [ciImpactScript, '--base', base, '--head', head];
  if (args.files !== undefined) {
    ciImpactArgs.push('--files', args.files);
  }

  const runners: ReadonlyArray<{
    cmd: string;
    args: string[];
    display: string;
  }> = [
    {
      cmd: process.execPath,
      args: ['--experimental-strip-types', ...ciImpactArgs],
      display: 'node --experimental-strip-types'
    },
    { cmd: 'tsx', args: ciImpactArgs, display: 'tsx' },
    {
      cmd: 'pnpm',
      args: ['exec', 'tsx', ...ciImpactArgs],
      display: 'pnpm exec tsx'
    },
    {
      cmd: process.execPath,
      args: ['--import', 'tsx', ...ciImpactArgs],
      display: 'node --import tsx'
    }
  ];

  let lastError = '';
  for (const runner of runners) {
    const result = spawnSync(runner.cmd, runner.args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env
    });

    const spawnError = result.error;
    if (
      spawnError !== undefined &&
      typeof spawnError === 'object' &&
      'code' in spawnError &&
      spawnError.code === 'ENOENT'
    ) {
      lastError = `${runner.display} not available`;
      continue;
    }

    if (typeof result.status === 'number' && result.status === 0) {
      return parseImpact(
        typeof result.stdout === 'string' ? result.stdout : ''
      );
    }

    const stderr = typeof result.stderr === 'string' ? result.stderr : '';
    throw new Error(stderr || `Failed to run ciImpact via ${runner.display}`);
  }
  throw new Error(lastError || 'Failed to find a ciImpact runner');
}

function requiresFullCoverageRun(changedFiles: string[]): boolean {
  for (const file of changedFiles) {
    if (FULL_RUN_EXACT_EXCEPTIONS.includes(file)) {
      continue;
    }
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

function isTestOnlyPath(filePath: string): boolean {
  return (
    /(^|\/)__tests__(\/|$)/.test(filePath) ||
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(filePath)
  );
}

function packageDirPrefix(pkg: string): string | null {
  const parts = pkg.split('/');
  const packageName = parts[1];
  if (packageName === undefined || packageName.length === 0) {
    return null;
  }
  return `packages/${packageName}/`;
}

function hasNonTestPackageChange(pkg: string, changedFiles: string[]): boolean {
  const prefix = packageDirPrefix(pkg);
  if (prefix === null) {
    return false;
  }

  const packageFiles = changedFiles.filter((file) => file.startsWith(prefix));
  if (packageFiles.length === 0) {
    return false;
  }

  return packageFiles.some((file) => !isTestOnlyPath(file));
}

function shouldRunCiImpactScriptTests(
  changedFiles: string[],
  fullRun: boolean
): boolean {
  if (fullRun) {
    return true;
  }
  return changedFiles.some((file) => CI_IMPACT_SCRIPT_TEST_REGEX.test(file));
}

function shouldRunFullCoverageSet(): boolean {
  return false;
}

function runCiImpactScriptTests(): void {
  const result = spawnSync(
    'node',
    ['--import', 'tsx', '--test', ...CI_IMPACT_SCRIPT_TEST_FILES],
    {
      stdio: 'inherit',
      env: process.env
    }
  );

  if (typeof result.status === 'number' && result.status !== 0) {
    process.exit(result.status);
  }

  if (result.status === null) {
    process.exit(1);
  }
}

function hasUncertainDiffWarning(warnings: string[]): boolean {
  // Keep this prefix aligned with the warning emitted in scripts/ciImpact/ciImpact.ts.
  return warnings.some((warning) => warning.startsWith('Unable to diff '));
}

function readPackageJson(filePath: string): PackageJsonShape {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null) {
    return {};
  }

  const scriptsRaw = Reflect.get(parsed, 'scripts');
  let scripts: Record<string, string> | undefined;
  if (typeof scriptsRaw === 'object' && scriptsRaw !== null) {
    const nextScripts: Record<string, string> = {};
    for (const [key, value] of Object.entries(scriptsRaw)) {
      if (typeof value === 'string') {
        nextScripts[key] = value;
      }
    }
    scripts = nextScripts;
  }

  const nameRaw = Reflect.get(parsed, 'name');
  const name = typeof nameRaw === 'string' ? nameRaw : undefined;
  const result: PackageJsonShape = {};
  if (typeof name === 'string') {
    result.name = name;
  }
  if (scripts !== undefined) {
    result.scripts = scripts;
  }
  return result;
}

function listCoveragePackages(): string[] {
  const packagesDir = 'packages';
  if (!fs.existsSync(packagesDir)) {
    return [];
  }
  const entries = fs.readdirSync(packagesDir, { withFileTypes: true });
  const workspacePackages: WorkspacePackage[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const packageJsonPath = path.join(packagesDir, entry.name, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      continue;
    }
    const pkg = readPackageJson(packageJsonPath);
    if (typeof pkg.name !== 'string') {
      continue;
    }
    const hasCoverageScript =
      typeof pkg.scripts?.['test:coverage'] === 'string';
    workspacePackages.push({
      name: pkg.name,
      hasCoverageScript
    });
  }

  return uniqueSorted(
    workspacePackages
      .filter((pkg) => pkg.hasCoverageScript)
      .map((pkg) => pkg.name)
  );
}

function main(): void {
  const args = parseArgs(process.argv);
  const impact = runCiImpact(args);
  if (hasUncertainDiffWarning(impact.warnings)) {
    console.error(
      'ci-impact: unable to compute a reliable diff for impacted test selection; failing closed.'
    );
    process.exit(1);
  }
  const coveragePackages = listCoveragePackages();
  const fullRun = requiresFullCoverageRun(impact.changedFiles);
  const runScriptTests = shouldRunCiImpactScriptTests(
    impact.changedFiles,
    fullRun
  );
  const runFullCoverageSet = shouldRunFullCoverageSet();

  const affectedSet = new Set(impact.affectedPackages);

  let targets: string[] = [];
  if (impact.materialFiles.length === 0) {
    targets = [];
  } else if (runFullCoverageSet) {
    targets = [...coveragePackages];
  } else {
    targets = coveragePackages.filter(
      (pkg) =>
        affectedSet.has(pkg) &&
        hasNonTestPackageChange(pkg, impact.materialFiles)
    );
  }

  targets = uniqueSorted(targets);

  if (args.printTargetsJson) {
    process.stdout.write(
      JSON.stringify(
        {
          targets,
          fullRun,
          runScriptTests,
          hasMaterialChanges: impact.materialFiles.length > 0
        },
        null,
        2
      )
    );
    process.stdout.write('\n');
    return;
  }

  if (impact.materialFiles.length === 0) {
    console.log('ci-impact: no material changes, skipping impacted tests.');
    return;
  }

  if (runScriptTests) {
    console.log('ci-impact: running ciImpact script tests.');
  } else {
    console.log('ci-impact: no impacted ciImpact script tests.');
  }

  if (args.scriptsOnly) {
    console.log('ci-impact: scripts-only mode enabled.');
  }

  if (!args.dryRun && runScriptTests) {
    runCiImpactScriptTests();
  }

  if (args.scriptsOnly) {
    return;
  }

  if (targets.length === 0) {
    console.log(
      'ci-impact: no impacted coverage packages, skipping coverage tests.'
    );
    return;
  }

  if (fullRun) {
    console.log(
      'ci-impact: high-risk changes detected; running impacted coverage only (global fanout disabled).'
    );
  } else {
    console.log('ci-impact: running impacted coverage packages only.');
  }
  console.log(`ci-impact: targets => ${targets.join(', ')}`);

  if (args.dryRun) {
    return;
  }

  for (const pkg of targets) {
    try {
      runCoverageForPackage(pkg);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : String(error ?? 'unknown error');
      console.error(message);
      process.exit(1);
    }
  }
}

main();
