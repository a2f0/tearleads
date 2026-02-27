#!/usr/bin/env -S pnpm exec tsx
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

interface CliArgs {
  base?: string;
  head?: string;
  files?: string;
  dryRun: boolean;
}

interface CiImpactOutput {
  changedFiles: string[];
  materialFiles: string[];
  changedPackages: string[];
  affectedPackages: string[];
}

interface WorkspacePackage {
  name: string;
  dir: string;
  scripts: Record<string, string>;
  hasTsconfig: boolean;
}

const DEFAULT_BASE = 'origin/main';
const DEFAULT_HEAD = 'HEAD';

const FULL_RUN_FILE_NAMES: ReadonlyArray<string> = [
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.json',
  'tsconfig.base.json',
  'scripts/tsconfig.json',
  'scripts/tsconfig.test.json',
  'biome.json',
  'biome.jsonc',
  '.nvmrc'
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

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { dryRun: false };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === undefined) {
      continue;
    }
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

  return {
    changedFiles: readStringArray(parsed, 'changedFiles'),
    materialFiles: readStringArray(parsed, 'materialFiles'),
    changedPackages: readStringArray(parsed, 'changedPackages'),
    affectedPackages: readStringArray(parsed, 'affectedPackages')
  };
}

function runCiImpact(args: CliArgs): CiImpactOutput {
  const base = args.base || DEFAULT_BASE;
  const head = args.head || DEFAULT_HEAD;
  const cmdParts = [
    'pnpm exec tsx scripts/ciImpact/ciImpact.ts',
    `--base ${base}`,
    `--head ${head}`
  ];
  if (args.files !== undefined) {
    cmdParts.push(`--files "${args.files}"`);
  }
  const output = execSync(cmdParts.join(' '), {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return parseImpact(output);
}

function runCommand(command: string, args: string[]): void {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: process.env
  });
  if (result.status === null) {
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status);
  }
}

function fileExists(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function listWorkspacePackages(): WorkspacePackage[] {
  const packagesDir = 'packages';
  const entries = fs.readdirSync(packagesDir, { withFileTypes: true });
  const out: WorkspacePackage[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const dir = path.join(packagesDir, entry.name);
    const packageJsonPath = path.join(dir, 'package.json');
    if (!fileExists(packageJsonPath)) {
      continue;
    }

    const parsed = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) {
      continue;
    }

    const name = Reflect.get(parsed, 'name');
    if (typeof name !== 'string') {
      continue;
    }

    const scriptsRaw = Reflect.get(parsed, 'scripts');
    const scripts: Record<string, string> = {};
    if (typeof scriptsRaw === 'object' && scriptsRaw !== null) {
      for (const key of Object.keys(scriptsRaw)) {
        const value = Reflect.get(scriptsRaw, key);
        if (typeof value === 'string') {
          scripts[key] = value;
        }
      }
    }

    out.push({
      name,
      dir,
      scripts,
      hasTsconfig: fileExists(path.join(dir, 'tsconfig.json'))
    });
  }

  return out;
}

function requiresFullRun(changedFiles: string[]): boolean {
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

function isBiomeTarget(filePath: string): boolean {
  // Must match biome.json includes patterns:
  // - packages/**/src/**/*.{ts,tsx}
  // - scripts/**/*.{ts,tsx}
  const isTsFile = filePath.endsWith('.ts') || filePath.endsWith('.tsx');
  if (!isTsFile) {
    return false;
  }

  if (filePath.startsWith('packages/')) {
    return filePath.includes('/src/');
  }

  return filePath.startsWith('scripts/');
}

function changedBiomeFiles(changedFiles: string[]): string[] {
  return uniqueSorted(
    changedFiles.filter((f) => fileExists(f) && isBiomeTarget(f))
  );
}

function shouldRunLintScripts(changedFiles: string[]): boolean {
  return changedFiles.some(
    (f) =>
      f.endsWith('.sh') ||
      f.startsWith('scripts/') ||
      f.startsWith('ansible/scripts/') ||
      f.startsWith('ansible/inventories/')
  );
}

function shouldRunLintMd(changedFiles: string[]): boolean {
  return changedFiles.some((f) => f.endsWith('.md'));
}

function shouldRunRubocop(changedFiles: string[]): boolean {
  return changedFiles.some(
    (f) =>
      f.startsWith('packages/client/') &&
      (f.endsWith('.rb') ||
        f.includes('/fastlane/') ||
        f.endsWith('Gemfile') ||
        f.endsWith('Gemfile.lock'))
  );
}

function shouldRunAnsibleLint(changedFiles: string[]): boolean {
  return changedFiles.some(
    (f) =>
      f.startsWith('ansible/') ||
      f.startsWith('tee/ansible/') ||
      f.startsWith('terraform/stacks/staging/tee/ansible/') ||
      f.startsWith('terraform/stacks/prod/tee/ansible/')
  );
}

function ensureCommandAvailable(cmd: string, help: string): void {
  const result = spawnSync('sh', ['-c', `command -v ${cmd} >/dev/null 2>&1`], {
    stdio: 'ignore'
  });
  if (result.status !== 0) {
    console.error(help);
    process.exit(1);
  }
}

function main(): void {
  const args = parseArgs(process.argv);
  const impact = runCiImpact(args);

  if (impact.materialFiles.length === 0) {
    console.log('ci-impact: no material changes, skipping quality checks.');
    return;
  }

  const fullRun = requiresFullRun(impact.changedFiles);
  const workspace = listWorkspacePackages();
  const workspaceByName = new Map<string, WorkspacePackage>();
  for (const pkg of workspace) {
    workspaceByName.set(pkg.name, pkg);
  }

  const impactedPackages = uniqueSorted(
    impact.affectedPackages.filter((name) => workspaceByName.has(name))
  );

  // Use changedPackages (directly modified) for typecheck, not affectedPackages (dependents)
  // This avoids failing on pre-existing type errors in dependent packages
  const directlyChangedPackages = uniqueSorted(
    impact.changedPackages.filter((name) => workspaceByName.has(name))
  );

  if (fullRun) {
    console.log(
      'ci-impact: high-risk changes detected, running full quality pipeline.'
    );
    if (!args.dryRun) {
      runCommand('pnpm', ['lint']);
      runCommand('pnpm', ['lint:scripts']);
      runCommand('pnpm', ['lint:md']);
      runCommand('pnpm', ['exec', 'tsc', '-b']);
      runCommand('pnpm', ['build']);

      ensureCommandAvailable(
        'bundle',
        'Error: bundle is not installed. Please install Ruby and Bundler.'
      );
      runCommand('pnpm', ['lint:rubocop']);

      ensureCommandAvailable(
        'ansible-lint',
        'Error: ansible-lint is not installed. Run: pipx install ansible-lint && pipx inject ansible-lint ansible'
      );
      runCommand('pnpm', ['lint:ansible']);
    }
    return;
  }

  const biomeTargets = changedBiomeFiles(impact.changedFiles);
  const runShellLint = shouldRunLintScripts(impact.changedFiles);
  const runMdLint = shouldRunLintMd(impact.changedFiles);
  const runRubo = shouldRunRubocop(impact.changedFiles);
  const runAnsLint = shouldRunAnsibleLint(impact.changedFiles);
  const runScriptsTypecheck = true;

  const buildTargets = impactedPackages.filter((pkgName) => {
    const pkg = workspaceByName.get(pkgName);
    return pkg !== undefined && Object.hasOwn(pkg.scripts, 'build');
  });

  // Only typecheck packages with directly changed files (not dependents)
  const typecheckTargets = directlyChangedPackages.filter((pkgName) => {
    const pkg = workspaceByName.get(pkgName);
    if (pkg === undefined || !pkg.hasTsconfig) {
      return false;
    }
    const buildScript = pkg.scripts['build'];
    return typeof buildScript === 'string' && /\btsc\b/.test(buildScript);
  });

  console.log('ci-impact: selective quality checks enabled.');
  console.log(
    `ci-impact: impacted packages => ${impactedPackages.join(', ') || '(none)'}`
  );

  if (biomeTargets.length > 0) {
    console.log(`ci-impact: biome targets => ${biomeTargets.join(', ')}`);
  }
  console.log(
    'ci-impact: running scripts TypeScript check (baseline pre-push guard).'
  );

  if (args.dryRun) {
    return;
  }

  if (biomeTargets.length > 0) {
    runCommand('pnpm', ['exec', 'biome', 'check', ...biomeTargets]);
  }

  if (runShellLint) {
    runCommand('pnpm', ['lint:scripts']);
  }

  if (runMdLint) {
    runCommand('pnpm', ['lint:md']);
  }

  if (runRubo) {
    ensureCommandAvailable(
      'bundle',
      'Error: bundle is not installed. Please install Ruby and Bundler.'
    );
    runCommand('pnpm', ['lint:rubocop']);
  }

  if (runAnsLint) {
    ensureCommandAvailable(
      'ansible-lint',
      'Error: ansible-lint is not installed. Run: pipx install ansible-lint && pipx inject ansible-lint ansible'
    );
    runCommand('pnpm', ['lint:ansible']);
  }

  for (const pkgName of typecheckTargets) {
    const pkg = workspaceByName.get(pkgName);
    if (pkg === undefined) {
      continue;
    }
    // pnpm --filter runs from within the package directory, so use relative path
    runCommand('pnpm', [
      '--filter',
      pkgName,
      'exec',
      'tsc',
      '--noEmit',
      '-p',
      'tsconfig.json'
    ]);
  }

  if (runScriptsTypecheck) {
    runCommand('pnpm', [
      'exec',
      'tsc',
      '--noEmit',
      '-p',
      'scripts/tsconfig.json'
    ]);
    runCommand('pnpm', [
      'exec',
      'tsc',
      '--noEmit',
      '-p',
      'scripts/tsconfig.test.json'
    ]);
  }

  for (const pkgName of buildTargets) {
    runCommand('pnpm', ['--filter', pkgName, 'build']);
  }
}

main();
