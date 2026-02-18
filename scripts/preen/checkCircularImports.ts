#!/usr/bin/env -S pnpm exec tsx
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

type AliasMapping = {
  alias: string;
  targetPackage: string;
};

type Cycle = {
  cycleKey: string;
  cycleNodes: string[];
};

const SHARED_PACKAGE = '@tearleads/shared';
const UI_PACKAGE = '@tearleads/ui';
const WINDOW_MANAGER_PACKAGE = '@tearleads/window-manager';
const CLIENT_PACKAGE = '@tearleads/client';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readJsonFile(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function listPackageDirs(packagesRoot: string): string[] {
  return fs
    .readdirSync(packagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((dirName) => {
      const packageDir = path.join(packagesRoot, dirName);
      return (
        fs.existsSync(path.join(packageDir, 'package.json')) &&
        fs.existsSync(path.join(packageDir, 'src'))
      );
    });
}

function getTargetPackageDir(resolvedPath: string): string | null {
  const normalized = resolvedPath.split(path.sep).join('/');
  const marker = '/packages/';
  const markerIndex = normalized.indexOf(marker);
  if (markerIndex < 0) {
    return null;
  }

  const afterPackages = normalized.slice(markerIndex + marker.length);
  const [targetDir, nextSegment] = afterPackages.split('/');
  if (!targetDir || nextSegment !== 'src') {
    return null;
  }

  return targetDir;
}

function matchesAlias(specifier: string, alias: string): boolean {
  if (alias.endsWith('/*')) {
    const prefix = alias.slice(0, -1);
    return specifier.startsWith(prefix);
  }
  return specifier === alias;
}

function collectTsFiles(dir: string): string[] {
  const files: string[] = [];
  const stack = [dir];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (!entry.isFile() || !/\.(ts|tsx)$/.test(entry.name)) {
        continue;
      }

      if (
        /\.(test|spec)\.(ts|tsx)$/.test(entry.name) ||
        fullPath.includes(`${path.sep}src${path.sep}test${path.sep}`) ||
        fullPath.includes(`${path.sep}src${path.sep}__tests__${path.sep}`)
      ) {
        continue;
      }

      files.push(fullPath);
    }
  }

  return files;
}

function normalizeCycle(cycleNodes: string[]): string {
  const sortedNodes = [...cycleNodes].sort();
  const minNode = sortedNodes[0];
  if (minNode === undefined) {
    return cycleNodes.join(' -> ');
  }
  const minIndex = cycleNodes.indexOf(minNode);
  return cycleNodes
    .slice(minIndex)
    .concat(cycleNodes.slice(0, minIndex))
    .join(' -> ');
}

function getSharedUiSuggestions(cycleNodes: string[]): string[] {
  const hasUi = cycleNodes.includes(UI_PACKAGE);
  const hasShared = cycleNodes.includes(SHARED_PACKAGE);
  const suggestions = [
    `Move non-visual shared code (types, validators, protocol helpers, pure utilities) into ${SHARED_PACKAGE}.`
  ];

  if (hasUi || !hasShared) {
    suggestions.push(
      `Move reusable UI code (React components, UI hooks/providers, styles) into ${UI_PACKAGE}.`
    );
  }

  if (hasUi) {
    suggestions.push(
      `Avoid routing non-UI helpers through ${UI_PACKAGE}; import those helpers from ${SHARED_PACKAGE} instead.`
    );
  }

  return suggestions;
}

function getNoClientImportSuggestions(): string[] {
  return [
    `Move non-UI shared logic (types, validators, protocols, pure utils) into ${SHARED_PACKAGE}.`,
    `Move reusable UI components/hooks/providers into ${UI_PACKAGE}.`,
    `Move windowing primitives and window state helpers into ${WINDOW_MANAGER_PACKAGE}.`,
    `Keep ${CLIENT_PACKAGE} as an app entrypoint/composition package; other packages should not import from it.`
  ];
}

function parseImportSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const importRegexes = [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\bimport\s*["']([^"']+)["']/g
  ];

  for (const regex of importRegexes) {
    regex.lastIndex = 0;
    let match = regex.exec(source);
    while (match) {
      const specifier = match[1];
      if (specifier) {
        specifiers.push(specifier);
      }
      match = regex.exec(source);
    }
  }

  return specifiers;
}

function runMadgeCheck(): void {
  const madgeResult = spawnSync(
    'npx madge --circular --extensions ts,tsx packages/*/src',
    {
      encoding: 'utf8',
      shell: true,
      stdio: ['ignore', 'pipe', 'ignore']
    }
  );

  const output = madgeResult.stdout ?? '';
  if (output.includes('Circular')) {
    console.error('Error: circular imports detected in the codebase.');
    console.error(
      `Hint: break shared dependencies by moving non-UI modules to ${SHARED_PACKAGE} and reusable UI modules to ${UI_PACKAGE}.`
    );
    console.error('');

    const circularIndex = output.indexOf('Circular');
    if (circularIndex >= 0) {
      console.error(output.slice(circularIndex).trimEnd());
    } else {
      console.error(output.trimEnd());
    }

    process.exit(1);
  }
}

function runPackageCycleCheck(repoRoot: string): void {
  const packagesRoot = path.join(repoRoot, 'packages');
  const packageDirs = listPackageDirs(packagesRoot);

  const packageNameByDir = new Map<string, string>();
  const packageDirByName = new Map<string, string>();
  for (const dirName of packageDirs) {
    const packageJsonPath = path.join(packagesRoot, dirName, 'package.json');
    const packageJson = readJsonFile(packageJsonPath);

    let packageName = `@tearleads/${dirName}`;
    if (isRecord(packageJson) && typeof packageJson.name === 'string') {
      packageName = packageJson.name;
    }

    packageNameByDir.set(dirName, packageName);
    packageDirByName.set(packageName, dirName);
  }

  const aliasMappingsByDir = new Map<string, AliasMapping[]>();
  for (const dirName of packageDirs) {
    const tsconfigPath = path.join(packagesRoot, dirName, 'tsconfig.json');
    const aliasMappings: AliasMapping[] = [];

    if (fs.existsSync(tsconfigPath)) {
      const tsconfig = readJsonFile(tsconfigPath);
      if (isRecord(tsconfig)) {
        const compilerOptions = tsconfig.compilerOptions;
        if (isRecord(compilerOptions)) {
          const pathsValue = compilerOptions.paths;
          if (isRecord(pathsValue)) {
            for (const [alias, targetValue] of Object.entries(pathsValue)) {
              if (!Array.isArray(targetValue)) {
                continue;
              }

              for (const target of targetValue) {
                if (typeof target !== 'string') {
                  continue;
                }

                const resolvedTarget = path.resolve(
                  packagesRoot,
                  dirName,
                  target
                );
                const targetDir = getTargetPackageDir(resolvedTarget);
                if (!targetDir || targetDir === dirName) {
                  continue;
                }

                const targetPackageName = packageNameByDir.get(targetDir);
                if (!targetPackageName) {
                  continue;
                }

                aliasMappings.push({
                  alias,
                  targetPackage: targetPackageName
                });
              }
            }
          }
        }
      }
    }

    aliasMappingsByDir.set(dirName, aliasMappings);
  }

  const packageDeps = new Map<string, Set<string>>();
  const edgeReasons = new Map<string, string>();
  const initPackage = (name: string): void => {
    if (!packageDeps.has(name)) {
      packageDeps.set(name, new Set<string>());
    }
  };

  for (const packageName of packageNameByDir.values()) {
    initPackage(packageName);
  }

  const addEdge = (fromPkg: string, toPkg: string, reason: string): void => {
    if (fromPkg === toPkg) {
      return;
    }

    initPackage(fromPkg);
    initPackage(toPkg);
    const deps = packageDeps.get(fromPkg);
    if (deps) {
      deps.add(toPkg);
    }

    const edgeKey = `${fromPkg} -> ${toPkg}`;
    if (!edgeReasons.has(edgeKey)) {
      edgeReasons.set(edgeKey, reason);
    }
  };

  for (const dirName of packageDirs) {
    const fromPackage = packageNameByDir.get(dirName);
    if (!fromPackage) {
      continue;
    }

    const srcDir = path.join(packagesRoot, dirName, 'src');
    const tsFiles = collectTsFiles(srcDir);
    const aliasMappings = aliasMappingsByDir.get(dirName) ?? [];

    for (const filePath of tsFiles) {
      const source = fs.readFileSync(filePath, 'utf8');
      const relativeFile = path.relative(repoRoot, filePath);
      const specifiers = parseImportSpecifiers(source);

      for (const specifier of specifiers) {
        if (specifier.startsWith('@tearleads/')) {
          const segments = specifier.split('/');
          const targetPackageName = `${segments[0]}/${segments[1]}`;
          if (packageDirByName.has(targetPackageName)) {
            addEdge(
              fromPackage,
              targetPackageName,
              `${relativeFile} imports '${specifier}'`
            );
          }
          continue;
        }

        // Legacy alias path used by non-client packages to import from client.
        if (specifier === '@client' || specifier.startsWith('@client/')) {
          addEdge(
            fromPackage,
            CLIENT_PACKAGE,
            `${relativeFile} imports '${specifier}'`
          );
          continue;
        }

        for (const aliasMapping of aliasMappings) {
          if (!matchesAlias(specifier, aliasMapping.alias)) {
            continue;
          }

          addEdge(
            fromPackage,
            aliasMapping.targetPackage,
            `${relativeFile} imports '${specifier}' via alias '${aliasMapping.alias}'`
          );
          break;
        }
      }
    }
  }

  const directClientDependents = [...packageDeps.entries()]
    .filter(
      ([packageName, deps]) =>
        packageName !== CLIENT_PACKAGE && deps.has(CLIENT_PACKAGE)
    )
    .map(([packageName]) => packageName)
    .sort();

  if (directClientDependents.length > 0) {
    const strictNoClientImports =
      process.env.PREEN_ENFORCE_NO_CLIENT_IMPORTS === '1';
    const log = strictNoClientImports ? console.error : console.warn;

    log(
      `${strictNoClientImports ? 'Error' : 'Warning'}: package imports from ${CLIENT_PACKAGE} detected.`
    );
    log(
      `Guidance: migrate shared modules out of ${CLIENT_PACKAGE} into ${SHARED_PACKAGE}, ${UI_PACKAGE}, or ${WINDOW_MANAGER_PACKAGE}.`
    );

    for (const dependentPackage of directClientDependents) {
      const edgeKey = `${dependentPackage} -> ${CLIENT_PACKAGE}`;
      const reason = edgeReasons.get(edgeKey) ?? 'dependency edge detected';
      log(`  - ${edgeKey}: ${reason}`);
    }

    const suggestions = getNoClientImportSuggestions();
    for (const suggestion of suggestions) {
      log(`  Suggestion: ${suggestion}`);
    }

    if (!strictNoClientImports) {
      log(
        '  Note: set PREEN_ENFORCE_NO_CLIENT_IMPORTS=1 to enforce this as a hard failure.'
      );
    } else {
      process.exit(1);
    }
  }

  const knownCycleKeys = new Set<string>();

  const discoveredCycles: Cycle[] = [];
  const seenCycleKeys = new Set<string>();

  const visit = (
    node: string,
    stack: string[],
    onStack: Set<string>,
    visited: Set<string>
  ): void => {
    visited.add(node);
    stack.push(node);
    onStack.add(node);

    const deps = packageDeps.get(node) ?? new Set<string>();
    for (const dep of deps) {
      if (!visited.has(dep)) {
        visit(dep, stack, onStack, visited);
        continue;
      }

      if (onStack.has(dep)) {
        const cycleStartIndex = stack.indexOf(dep);
        const cycleNodes = stack.slice(cycleStartIndex);
        const cycleKey = normalizeCycle(cycleNodes);

        if (!seenCycleKeys.has(cycleKey)) {
          seenCycleKeys.add(cycleKey);
          discoveredCycles.push({ cycleKey, cycleNodes });
        }
      }
    }

    stack.pop();
    onStack.delete(node);
  };

  const visited = new Set<string>();
  for (const node of packageDeps.keys()) {
    if (!visited.has(node)) {
      visit(node, [], new Set<string>(), visited);
    }
  }

  const unexpectedCycles = discoveredCycles.filter(
    ({ cycleKey }) => !knownCycleKeys.has(cycleKey)
  );

  if (unexpectedCycles.length > 0) {
    console.error('Error: package-level circular dependencies detected.');
    console.error(
      `Hint: if two packages need the same module, extract non-UI code to ${SHARED_PACKAGE} or reusable UI code to ${UI_PACKAGE}.`
    );

    for (const { cycleKey, cycleNodes } of unexpectedCycles) {
      const cyclePath = cycleNodes.concat(cycleNodes[0] ?? '');
      console.error('');
      console.error(`Cycle: ${cyclePath.join(' -> ')}`);
      console.error(`  Normalized key: ${cycleKey}`);

      for (let index = 0; index < cycleNodes.length; index += 1) {
        const from = cycleNodes[index] ?? '';
        const to = cyclePath[index + 1] ?? '';
        const edgeKey = `${from} -> ${to}`;
        const reason = edgeReasons.get(edgeKey) ?? 'dependency edge detected';
        console.error(`  - ${edgeKey}: ${reason}`);
      }

      const suggestions = getSharedUiSuggestions(cycleNodes);
      for (const suggestion of suggestions) {
        console.error(`  Suggestion: ${suggestion}`);
      }
    }

    process.exit(1);
  }
}

function main(): void {
  const currentFilePath = fileURLToPath(import.meta.url);
  const scriptDir = path.dirname(currentFilePath);
  const repoRoot = path.resolve(scriptDir, '../..');
  process.chdir(repoRoot);

  runMadgeCheck();
  runPackageCycleCheck(repoRoot);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
