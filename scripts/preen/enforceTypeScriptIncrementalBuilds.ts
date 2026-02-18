#!/usr/bin/env -S pnpm exec tsx
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT_DIR = process.cwd();
const ROOT_TSCONFIG = path.join(ROOT_DIR, 'tsconfig.json');

const REQUIRED_PROJECTS = [
  'packages/client/tsconfig.json',
  'packages/chrome-extension/tsconfig.json',
  'packages/website/tsconfig.json',
  'scripts/tsconfig.json',
  'scripts/tsconfig.test.json'
] as const;

type JsonObject = Record<string, unknown>;

type TsConfig = {
  references?: Array<{ path: string }>;
  compilerOptions?: JsonObject;
};

const normalizePath = (value: string): string => value.split(path.sep).join('/');

const resolveProjectPath = (baseDir: string, refPath: string): string => {
  const absolute = path.resolve(baseDir, refPath);
  if (absolute.endsWith('.json')) {
    return absolute;
  }

  return path.join(absolute, 'tsconfig.json');
};

const readJsonFile = async (filePath: string): Promise<JsonObject> => {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw) as JsonObject;
};

const collectReferencedProjects = async (
  entryConfigPath: string,
  visited = new Set<string>()
): Promise<Set<string>> => {
  const resolvedEntry = path.resolve(entryConfigPath);
  if (visited.has(resolvedEntry)) {
    return visited;
  }

  visited.add(resolvedEntry);
  const config = (await readJsonFile(resolvedEntry)) as TsConfig;
  const references = config.references ?? [];

  for (const reference of references) {
    const childPath = resolveProjectPath(path.dirname(resolvedEntry), reference.path);
    await collectReferencedProjects(childPath, visited);
  }

  return visited;
};

const validateCompilerOptions = async (projectPath: string): Promise<string[]> => {
  const config = (await readJsonFile(path.join(ROOT_DIR, projectPath))) as TsConfig;
  const compilerOptions = config.compilerOptions ?? {};
  const failures: string[] = [];

  const hasIncrementalMode =
    compilerOptions.composite === true || compilerOptions.incremental === true;
  if (!hasIncrementalMode) {
    failures.push(
      `${projectPath}: set compilerOptions.incremental=true (or composite=true) for build caching`
    );
  }

  const tsBuildInfoFile = compilerOptions.tsBuildInfoFile;
  if (typeof tsBuildInfoFile !== 'string' || tsBuildInfoFile.length === 0) {
    failures.push(
      `${projectPath}: compilerOptions.tsBuildInfoFile must be set for deterministic incremental artifacts`
    );
  }

  return failures;
};

const main = async (): Promise<void> => {
  const failures: string[] = [];

  const referencedProjects = await collectReferencedProjects(ROOT_TSCONFIG);
  const referencedRelative = new Set(
    [...referencedProjects].map((absolutePath) => normalizePath(path.relative(ROOT_DIR, absolutePath)))
  );

  for (const requiredProject of REQUIRED_PROJECTS) {
    if (!referencedRelative.has(requiredProject)) {
      failures.push(`Root tsconfig build graph missing ${requiredProject}`);
    }
  }

  for (const requiredProject of REQUIRED_PROJECTS) {
    const optionFailures = await validateCompilerOptions(requiredProject);
    failures.push(...optionFailures);
  }

  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log(
    `TypeScript incremental build enforcement passed for ${REQUIRED_PROJECTS.length} required projects.`
  );
};

void main();
