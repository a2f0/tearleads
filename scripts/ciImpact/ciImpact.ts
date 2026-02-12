#!/usr/bin/env -S pnpm exec tsx
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

type JobName =
  | 'build'
  | 'web-e2e'
  | 'website-e2e'
  | 'electron-e2e'
  | 'android'
  | 'android-maestro-release'
  | 'ios-maestro-release';

const ALL_JOB_NAMES: ReadonlyArray<JobName> = [
  'build',
  'web-e2e',
  'website-e2e',
  'electron-e2e',
  'android',
  'android-maestro-release',
  'ios-maestro-release'
];

type StringSetMap = Map<string, Set<string>>;

interface CliArgs {
  base?: string;
  head?: string;
  files?: string;
}

interface Config {
  ignoredPrefixes: string[];
  ignoredExact: string[];
  ignoredSuffixes: string[];
  workflowCriticalPrefixes: string[];
  clientRuntimePackages: string[];
  jobNames: JobName[];
}

interface PackageJsonShape {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

interface WorkspacePackage {
  name: string;
  dir: string;
  json: PackageJsonShape;
}

interface WorkspaceLookup {
  byName: Map<string, WorkspacePackage>;
  byDir: Map<string, string>;
}

interface JobState {
  run: boolean;
  reasons: string[];
}

type JobDecision = Record<JobName, JobState>;

interface EvaluateInput {
  changedFiles: string[];
  materialFiles: string[];
  affectedPackages: Set<string>;
  config: Config;
}

interface OutputPayload {
  base: string;
  head: string;
  changedFiles: string[];
  materialFiles: string[];
  changedPackages: string[];
  affectedPackages: string[];
  jobs: JobDecision;
  warnings: string[];
}

const ROOT = process.cwd();
const CONFIG_PATH = path.join(ROOT, 'scripts/ciImpact/job-groups.json');
const FALLBACK_DIFF = 'HEAD~1...HEAD';

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    const hasValue = next !== undefined && !next.startsWith('--');
    if (!hasValue) {
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

function run(cmd: string): string {
  return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function hasPath(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function isStringArray(value: object, key: string): boolean {
  if (!(key in value)) {
    return false;
  }
  const v = Reflect.get(value, key);
  if (!Array.isArray(v)) {
    return false;
  }
  return v.every((item) => typeof item === 'string');
}

function readStringArray(value: object, key: string): string[] {
  const out: string[] = [];
  const raw = Reflect.get(value, key);
  if (!Array.isArray(raw)) {
    return out;
  }
  for (const item of raw) {
    if (typeof item === 'string') {
      out.push(item);
    }
  }
  return out;
}

function isJobName(value: string): value is JobName {
  return (
    value === 'build' ||
    value === 'web-e2e' ||
    value === 'website-e2e' ||
    value === 'electron-e2e' ||
    value === 'android' ||
    value === 'android-maestro-release' ||
    value === 'ios-maestro-release'
  );
}

function readConfig(filePath: string): Config {
  const text = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Invalid config JSON: expected object at root');
  }
  if (!isStringArray(parsed, 'ignoredPrefixes')) {
    throw new Error('Invalid config JSON: ignoredPrefixes');
  }
  if (!isStringArray(parsed, 'ignoredExact')) {
    throw new Error('Invalid config JSON: ignoredExact');
  }
  if (!isStringArray(parsed, 'ignoredSuffixes')) {
    throw new Error('Invalid config JSON: ignoredSuffixes');
  }
  if (!isStringArray(parsed, 'workflowCriticalPrefixes')) {
    throw new Error('Invalid config JSON: workflowCriticalPrefixes');
  }
  if (!isStringArray(parsed, 'clientRuntimePackages')) {
    throw new Error('Invalid config JSON: clientRuntimePackages');
  }
  if (!isStringArray(parsed, 'jobNames')) {
    throw new Error('Invalid config JSON: jobNames');
  }

  const rawJobNames = Reflect.get(parsed, 'jobNames');
  if (!Array.isArray(rawJobNames) || !rawJobNames.every((name) => typeof name === 'string' && isJobName(name))) {
    throw new Error('Invalid config JSON: jobNames must be known CI jobs');
  }

  return {
    ignoredPrefixes: readStringArray(parsed, 'ignoredPrefixes'),
    ignoredExact: readStringArray(parsed, 'ignoredExact'),
    ignoredSuffixes: readStringArray(parsed, 'ignoredSuffixes'),
    workflowCriticalPrefixes: readStringArray(parsed, 'workflowCriticalPrefixes'),
    clientRuntimePackages: readStringArray(parsed, 'clientRuntimePackages'),
    jobNames: rawJobNames
  };
}

function readPackageJson(filePath: string): PackageJsonShape {
  const text = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null) {
    return {};
  }

  const data: PackageJsonShape = {};
  const name = Reflect.get(parsed, 'name');
  if (typeof name === 'string') {
    data.name = name;
  }

  const depKeys: Array<keyof PackageJsonShape> = ['dependencies', 'devDependencies', 'peerDependencies'];
  for (const depKey of depKeys) {
    const depValue = Reflect.get(parsed, depKey);
    if (typeof depValue === 'object' && depValue !== null) {
      const rec: Record<string, string> = {};
      for (const depName of Object.keys(depValue)) {
        const depVersion = Reflect.get(depValue, depName);
        if (typeof depVersion === 'string') {
          rec[depName] = depVersion;
        }
      }
      if (Object.keys(rec).length > 0) {
        data[depKey] = rec;
      }
    }
  }

  return data;
}

function listWorkspacePackages(): WorkspaceLookup {
  const packagesDir = path.join(ROOT, 'packages');
  const entries = fs.readdirSync(packagesDir, { withFileTypes: true });
  const byName = new Map<string, WorkspacePackage>();
  const byDir = new Map<string, string>();

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const dir = path.join('packages', entry.name);
    const packageJsonPath = path.join(ROOT, dir, 'package.json');
    if (!hasPath(packageJsonPath)) {
      continue;
    }
    const pkgJson = readPackageJson(packageJsonPath);
    if (pkgJson.name === undefined) {
      continue;
    }

    const pkg: WorkspacePackage = {
      name: pkgJson.name,
      dir,
      json: pkgJson
    };

    byName.set(pkg.name, pkg);
    byDir.set(dir, pkg.name);
  }

  return { byName, byDir };
}

function unionDeps(pkg: PackageJsonShape): Record<string, string> {
  return {
    ...(pkg.dependencies || {}),
    ...(pkg.devDependencies || {}),
    ...(pkg.peerDependencies || {})
  };
}

function buildReverseGraph(packagesByName: Map<string, WorkspacePackage>): StringSetMap {
  const reverse: StringSetMap = new Map<string, Set<string>>();

  for (const pkgName of packagesByName.keys()) {
    reverse.set(pkgName, new Set<string>());
  }

  for (const [fromPkg, pkgInfo] of packagesByName.entries()) {
    const deps = unionDeps(pkgInfo.json);
    for (const depName of Object.keys(deps)) {
      if (!packagesByName.has(depName)) {
        continue;
      }
      const existing = reverse.get(depName);
      if (existing === undefined) {
        reverse.set(depName, new Set<string>([fromPkg]));
      } else {
        existing.add(fromPkg);
      }
    }
  }

  return reverse;
}

function splitCsv(value: string): string[] {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function diffFiles(range: string): string[] {
  const output = run(`git diff --name-only ${range}`);
  if (output.length === 0) {
    return [];
  }
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function detectChangedFiles(base: string, head: string, filesArg?: string): string[] {
  if (filesArg !== undefined) {
    return splitCsv(filesArg);
  }

  const primaryRange = `${base}...${head}`;
  try {
    return diffFiles(primaryRange);
  } catch {
    return diffFiles(FALLBACK_DIFF);
  }
}

function startsWithOneOf(file: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => file.startsWith(prefix));
}

function isIgnored(file: string, config: Config): boolean {
  if (config.ignoredExact.includes(file)) {
    return true;
  }
  if (config.ignoredSuffixes.some((suffix) => file.endsWith(suffix))) {
    return true;
  }
  if (startsWithOneOf(file, config.ignoredPrefixes)) {
    return true;
  }
  return false;
}

function packageFromFile(file: string, byDir: Map<string, string>): string | null {
  for (const [dir, pkgName] of byDir.entries()) {
    if (file === dir || file.startsWith(`${dir}/`)) {
      return pkgName;
    }
  }
  return null;
}

function transitiveDependents(changedPackages: Set<string>, reverseGraph: StringSetMap): Set<string> {
  const impacted = new Set<string>(changedPackages);
  const queue = [...changedPackages];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) {
      continue;
    }
    const dependents = reverseGraph.get(current);
    if (dependents === undefined) {
      continue;
    }
    for (const dep of dependents) {
      if (impacted.has(dep)) {
        continue;
      }
      impacted.add(dep);
      queue.push(dep);
    }
  }

  return impacted;
}

function blankJobs(jobNames: JobName[]): JobDecision {
  const jobs: Partial<JobDecision> = {};
  for (const name of jobNames) {
    jobs[name] = { run: false, reasons: [] };
  }

  for (const name of ALL_JOB_NAMES) {
    if (jobs[name] === undefined) {
      throw new Error(`Config missing one or more required jobs: ${name}`);
    }
  }

  function mustGet(name: JobName): JobState {
    const state = jobs[name];
    if (state === undefined) {
      throw new Error(`Config missing one or more required jobs: ${name}`);
    }
    return state;
  }

  return {
    build: mustGet('build'),
    'web-e2e': mustGet('web-e2e'),
    'website-e2e': mustGet('website-e2e'),
    'electron-e2e': mustGet('electron-e2e'),
    android: mustGet('android'),
    'android-maestro-release': mustGet('android-maestro-release'),
    'ios-maestro-release': mustGet('ios-maestro-release')
  };
}

function evaluateJobs(input: EvaluateInput): JobDecision {
  const { changedFiles, materialFiles, affectedPackages, config } = input;
  const jobs = blankJobs(config.jobNames);

  if (materialFiles.length === 0) {
    return jobs;
  }

  jobs.build.run = true;
  jobs.build.reasons.push('material file changes detected');

  const workflowCriticalChanged = changedFiles.some((file) => startsWithOneOf(file, config.workflowCriticalPrefixes));
  if (workflowCriticalChanged) {
    for (const name of config.jobNames) {
      jobs[name].run = true;
      jobs[name].reasons.push('workflow/config changed: run full integration matrix');
    }
    return jobs;
  }

  const hasClientRuntimeImpact = [...affectedPackages].some((pkgName) => config.clientRuntimePackages.includes(pkgName));
  const hasWebsiteImpact = affectedPackages.has('@tearleads/website');
  const hasApiImpact = affectedPackages.has('@tearleads/api');
  const hasClientImpact = affectedPackages.has('@tearleads/client');

  const hasWebE2ETestFiles = changedFiles.some(
    (file) => file === 'packages/client/playwright.config.ts' || /^packages\/client\/tests\/.*\.spec\.ts$/.test(file)
  );
  const hasElectronSpecific = changedFiles.some(
    (file) =>
      file.startsWith('packages/client/electron/') ||
      file.startsWith('packages/client/tests/electron/') ||
      file === 'packages/client/playwright.electron.config.ts'
  );
  const hasWebsiteFiles = changedFiles.some((file) => file.startsWith('packages/website/'));
  const hasAndroidSpecific = changedFiles.some(
    (file) =>
      file.startsWith('packages/client/android/') ||
      file.startsWith('android/') ||
      file.startsWith('packages/client/fastlane/') ||
      file.startsWith('fastlane/') ||
      file === 'packages/client/capacitor.config.ts'
  );
  const hasIosSpecific = changedFiles.some(
    (file) =>
      file.startsWith('packages/client/ios/') ||
      file.startsWith('ios/') ||
      file.startsWith('packages/client/fastlane/') ||
      file.startsWith('fastlane/') ||
      file === 'packages/client/capacitor.config.ts'
  );
  const hasMaestroSpecific = changedFiles.some((file) => file.startsWith('packages/client/.maestro/'));
  const hasMobileSpecific = hasAndroidSpecific || hasIosSpecific || hasMaestroSpecific;

  if (hasWebE2ETestFiles || hasClientImpact || hasApiImpact || hasClientRuntimeImpact) {
    jobs['web-e2e'].run = true;
    jobs['web-e2e'].reasons.push('client/web runtime or e2e test surface impacted');
  }

  if (hasWebsiteFiles || hasWebsiteImpact || hasApiImpact) {
    jobs['website-e2e'].run = true;
    jobs['website-e2e'].reasons.push('website or API surface impacted');
  }

  if (hasElectronSpecific || hasClientImpact || hasClientRuntimeImpact) {
    jobs['electron-e2e'].run = true;
    jobs['electron-e2e'].reasons.push('electron/client runtime surface impacted');
  }

  if (hasMobileSpecific || hasClientRuntimeImpact) {
    if (hasAndroidSpecific || hasClientRuntimeImpact || hasMaestroSpecific) {
      jobs.android.run = true;
      jobs.android.reasons.push(
        hasAndroidSpecific
          ? 'android-specific files changed'
          : hasMaestroSpecific
            ? 'maestro files changed'
            : 'shared client runtime surface impacted'
      );
      jobs['android-maestro-release'].run = true;
      jobs['android-maestro-release'].reasons.push(
        hasAndroidSpecific
          ? 'android files changed'
          : hasMaestroSpecific
            ? 'maestro files changed'
            : 'shared client runtime surface impacted'
      );
    }

    if (hasIosSpecific || hasClientRuntimeImpact || hasMaestroSpecific) {
      jobs['ios-maestro-release'].run = true;
      jobs['ios-maestro-release'].reasons.push(
        hasIosSpecific
          ? 'ios files changed'
          : hasMaestroSpecific
            ? 'maestro files changed'
            : 'shared client runtime surface impacted'
      );
    }
  }

  const tuxedoOnly =
    materialFiles.length > 0 &&
    materialFiles.every(
      (file) =>
        file.startsWith('tuxedo/') ||
        file.startsWith('ansible/') ||
        file.startsWith('scripts/tuxedo') ||
        file === 'tuxedo/tuxedo.sh'
    );

  if (tuxedoOnly) {
    jobs.android.run = false;
    jobs.android.reasons = [];
    jobs['android-maestro-release'].run = false;
    jobs['android-maestro-release'].reasons = [];
    jobs['ios-maestro-release'].run = false;
    jobs['ios-maestro-release'].reasons = [];
  }

  return jobs;
}

function main(): void {
  const args = parseArgs(process.argv);
  const base = args.base || 'origin/main';
  const head = args.head || 'HEAD';

  const config = readConfig(CONFIG_PATH);
  const { byName, byDir } = listWorkspacePackages();
  const reverseGraph = buildReverseGraph(byName);
  const changedFiles = detectChangedFiles(base, head, args.files);

  const changedPackages = new Set<string>();
  for (const file of changedFiles) {
    const pkgName = packageFromFile(file, byDir);
    if (pkgName !== null) {
      changedPackages.add(pkgName);
    }
  }

  const affectedPackages = transitiveDependents(changedPackages, reverseGraph);
  const materialFiles = changedFiles.filter((file) => !isIgnored(file, config));
  const jobs = evaluateJobs({
    changedFiles,
    materialFiles,
    affectedPackages,
    config
  });

  const warnings: string[] = [];
  if (changedFiles.length > 0 && materialFiles.length === 0) {
    warnings.push('All file changes are ignored by trigger policy (docs/config-only).');
  }
  const hasUnmappedWorkspaceFile = changedFiles.some(
    (file) => file.startsWith('packages/') && packageFromFile(file, byDir) === null
  );
  if (hasUnmappedWorkspaceFile) {
    warnings.push('Some files under packages/ did not map to a package.json workspace.');
  }

  const output: OutputPayload = {
    base,
    head,
    changedFiles,
    materialFiles,
    changedPackages: [...changedPackages].sort(),
    affectedPackages: [...affectedPackages].sort(),
    jobs,
    warnings
  };

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main();
