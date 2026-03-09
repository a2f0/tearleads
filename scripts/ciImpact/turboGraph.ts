import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export type StringSetMap = Map<string, Set<string>>;

export interface WorkspacePackage {
  name: string;
  dir: string;
}

export interface WorkspaceLookup {
  byName: Map<string, WorkspacePackage>;
  byDir: Map<string, string>;
}

interface WorkspaceGraphResult {
  lookup: WorkspaceLookup;
  reverseGraph: StringSetMap;
}

interface TurboPackageItem {
  name: string;
  path: string;
  directDependents: { items: ReadonlyArray<{ name: string }> };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStringField(obj: object, key: string): boolean {
  return typeof Reflect.get(obj, key) === 'string';
}

export function parseTurboQueryResponse(
  raw: string
): ReadonlyArray<TurboPackageItem> {
  const parsed: unknown = JSON.parse(raw);
  if (!isObject(parsed)) {
    throw new Error('turbo query: expected object at root');
  }
  const data = Reflect.get(parsed, 'data');
  if (!isObject(data)) {
    throw new Error('turbo query: missing data');
  }
  const packages = Reflect.get(data, 'packages');
  if (!isObject(packages)) {
    throw new Error('turbo query: missing data.packages');
  }
  const items = Reflect.get(packages, 'items');
  if (!Array.isArray(items)) {
    throw new Error('turbo query: missing data.packages.items');
  }

  const result: TurboPackageItem[] = [];
  for (const item of items) {
    if (!isObject(item)) {
      throw new Error('turbo query: package item is not an object');
    }
    if (!isStringField(item, 'name') || !isStringField(item, 'path')) {
      throw new Error('turbo query: package item missing name or path');
    }
    const directDependents = Reflect.get(item, 'directDependents');
    if (!isObject(directDependents)) {
      throw new Error('turbo query: missing directDependents');
    }
    const depItems = Reflect.get(directDependents, 'items');
    if (!Array.isArray(depItems)) {
      throw new Error('turbo query: directDependents.items not an array');
    }
    const validDepItems: Array<{ name: string }> = [];
    for (const depItem of depItems) {
      if (!isObject(depItem) || !isStringField(depItem, 'name')) {
        throw new Error('turbo query: dependent item missing name');
      }
      validDepItems.push({ name: String(Reflect.get(depItem, 'name')) });
    }
    result.push({
      name: String(Reflect.get(item, 'name')),
      path: String(Reflect.get(item, 'path')),
      directDependents: { items: validDepItems }
    });
  }
  return result;
}

function buildFromTurboItems(
  items: ReadonlyArray<TurboPackageItem>
): WorkspaceGraphResult {
  const byName = new Map<string, WorkspacePackage>();
  const byDir = new Map<string, string>();
  const reverseGraph: StringSetMap = new Map<string, Set<string>>();

  for (const item of items) {
    if (item.name === '//') {
      continue;
    }
    byName.set(item.name, { name: item.name, dir: item.path });
    byDir.set(item.path, item.name);
    reverseGraph.set(item.name, new Set<string>());
  }

  for (const item of items) {
    if (item.name === '//') {
      continue;
    }
    for (const dep of item.directDependents.items) {
      if (dep.name === '//') {
        continue;
      }
      const existing = reverseGraph.get(item.name);
      if (existing !== undefined) {
        existing.add(dep.name);
      }
    }
  }

  return { lookup: { byName, byDir }, reverseGraph };
}

function loadFromTurbo(): WorkspaceGraphResult | null {
  try {
    const raw = execSync(
      "npx turbo query '{ packages { items { name path directDependents { items { name } } } } }'",
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    ).trim();
    const items = parseTurboQueryResponse(raw);
    return buildFromTurboItems(items);
  } catch {
    return null;
  }
}

function loadFromPackageJson(): WorkspaceGraphResult {
  const root = process.cwd();
  const packagesDir = path.join(root, 'packages');
  const entries = fs.readdirSync(packagesDir, { withFileTypes: true });
  const byName = new Map<string, WorkspacePackage>();
  const byDir = new Map<string, string>();
  const depMap = new Map<string, Set<string>>();

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const dir = path.join('packages', entry.name);
    const pkgPath = path.join(root, dir, 'package.json');
    try {
      fs.accessSync(pkgPath, fs.constants.F_OK);
    } catch {
      continue;
    }
    const text = fs.readFileSync(pkgPath, 'utf8');
    const parsed: unknown = JSON.parse(text);
    if (!isObject(parsed)) {
      continue;
    }
    const name = Reflect.get(parsed, 'name');
    if (typeof name !== 'string') {
      continue;
    }
    byName.set(name, { name, dir });
    byDir.set(dir, name);

    const allDeps = new Set<string>();
    for (const depKey of [
      'dependencies',
      'devDependencies',
      'peerDependencies'
    ]) {
      const depValue = Reflect.get(parsed, depKey);
      if (isObject(depValue)) {
        for (const depName of Object.keys(depValue)) {
          allDeps.add(depName);
        }
      }
    }
    depMap.set(name, allDeps);
  }

  const reverseGraph: StringSetMap = new Map<string, Set<string>>();
  for (const pkgName of byName.keys()) {
    reverseGraph.set(pkgName, new Set<string>());
  }
  for (const [fromPkg, deps] of depMap.entries()) {
    for (const depName of deps) {
      if (!byName.has(depName)) {
        continue;
      }
      const existing = reverseGraph.get(depName);
      if (existing !== undefined) {
        existing.add(fromPkg);
      }
    }
  }

  return { lookup: { byName, byDir }, reverseGraph };
}

export function loadWorkspaceGraph(): WorkspaceGraphResult {
  return loadFromTurbo() ?? loadFromPackageJson();
}
