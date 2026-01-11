import fs from 'node:fs';
import path from 'node:path';

interface PackageJson {
  name?: string;
  version?: string;
  license?: string | { type: string };
  licenses?: Array<{ type: string }>;
  repository?: string | { type?: string; url?: string };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

interface LicenseInfo {
  name: string;
  version: string;
  license: string;
  repository?: string;
}

function extractLicense(pkg: PackageJson): string {
  if (typeof pkg.license === 'string') return pkg.license;
  if (pkg.license && typeof pkg.license === 'object' && pkg.license.type) {
    return pkg.license.type;
  }
  if (Array.isArray(pkg.licenses) && pkg.licenses.length > 0) {
    return pkg.licenses.map((l) => l.type).join(' OR ');
  }
  return 'Unknown';
}

function extractRepository(pkg: PackageJson): string | undefined {
  if (!pkg.repository) return undefined;

  let url: string;
  if (typeof pkg.repository === 'string') {
    url = pkg.repository;
  } else if (pkg.repository.url) {
    url = pkg.repository.url;
  } else {
    return undefined;
  }

  // Clean up git URLs to be browser-friendly
  url = url
    .replace(/^git\+/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/\.git$/, '')
    .replace(/^ssh:\/\/git@github\.com/, 'https://github.com')
    .replace(/^git@github\.com:/, 'https://github.com/');

  return url;
}

function findPackageInNodeModules(
  monorepoRoot: string,
  packageName: string
): PackageJson | null {
  // Try direct node_modules path first (hoisted packages)
  const directPath = path.join(
    monorepoRoot,
    'node_modules',
    packageName,
    'package.json'
  );
  if (fs.existsSync(directPath)) {
    try {
      return JSON.parse(fs.readFileSync(directPath, 'utf-8')) as PackageJson;
    } catch (e) {
      console.warn(`Could not parse ${directPath}, continuing search:`, e);
    }
  }

  // Try .pnpm directory structure
  const pnpmDir = path.join(monorepoRoot, 'node_modules/.pnpm');
  if (!fs.existsSync(pnpmDir)) return null;

  const entries = fs.readdirSync(pnpmDir, { withFileTypes: true });

  // Handle scoped packages (@org/package -> @org+package in .pnpm)
  const pnpmName = packageName.replace('/', '+');

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    // Match package directories that start with the package name
    // Format: package-name@version or @scope+package-name@version
    if (entry.name.startsWith(pnpmName + '@')) {
      const pkgJsonPath = path.join(
        pnpmDir,
        entry.name,
        'node_modules',
        packageName,
        'package.json'
      );
      if (fs.existsSync(pkgJsonPath)) {
        try {
          return JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8')) as PackageJson;
        } catch (e) {
          console.warn(`Could not parse ${pkgJsonPath}, continuing search:`, e);
          continue;
        }
      }
    }
  }

  return null;
}

function getWorkspacePackageJsonPaths(monorepoRoot: string): string[] {
  const paths: string[] = [];

  // Add root package.json
  const rootPkgJson = path.join(monorepoRoot, 'package.json');
  if (fs.existsSync(rootPkgJson)) {
    paths.push(rootPkgJson);
  }

  // Read workspace globs from pnpm-workspace.yaml
  const workspaceYamlPath = path.join(monorepoRoot, 'pnpm-workspace.yaml');
  if (!fs.existsSync(workspaceYamlPath)) {
    console.warn('pnpm-workspace.yaml not found, falling back to packages/*');
    return findPackagesInDir(path.join(monorepoRoot, 'packages'), paths);
  }

  const workspaceYaml = fs.readFileSync(workspaceYamlPath, 'utf-8');
  // Simple YAML parsing for packages array (handles "- 'packages/*'" format)
  const packagesMatch = workspaceYaml.match(/packages:\s*\n((?:\s*-\s*['"]?[^'"\n]+['"]?\s*\n?)+)/);
  if (!packagesMatch) {
    console.warn('Could not parse packages from pnpm-workspace.yaml');
    return paths;
  }

  const globs = packagesMatch[1]
    .split('\n')
    .map((line) => line.replace(/^\s*-\s*['"]?/, '').replace(/['"]?\s*$/, ''))
    .filter((g) => g.length > 0);

  for (const glob of globs) {
    // Handle simple glob patterns like "packages/*"
    if (glob.endsWith('/*')) {
      const baseDir = path.join(monorepoRoot, glob.slice(0, -2));
      findPackagesInDir(baseDir, paths);
    }
  }

  return paths;
}

function findPackagesInDir(dir: string, paths: string[]): string[] {
  if (!fs.existsSync(dir)) return paths;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pkgJsonPath = path.join(dir, entry.name, 'package.json');
    if (fs.existsSync(pkgJsonPath)) {
      paths.push(pkgJsonPath);
    }
  }
  return paths;
}

function collectDependencies(pkgJson: PackageJson): Set<string> {
  const deps = new Set<string>();

  const allDeps = {
    ...pkgJson.dependencies,
    ...pkgJson.devDependencies,
    ...pkgJson.peerDependencies
  };

  for (const [name, version] of Object.entries(allDeps)) {
    // Skip workspace dependencies
    if (version.startsWith('workspace:')) continue;
    deps.add(name);
  }

  return deps;
}

function generateLicenses(): void {
  const monorepoRoot = path.resolve(import.meta.dirname, '../../..');
  const workspacePaths = getWorkspacePackageJsonPaths(monorepoRoot);

  if (workspacePaths.length === 0) {
    console.error('Error: No workspace package.json files found.');
    process.exit(1);
  }

  // Collect all unique top-level dependencies
  const allDeps = new Set<string>();
  for (const pkgPath of workspacePaths) {
    try {
      const pkgJson: PackageJson = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const deps = collectDependencies(pkgJson);
      for (const dep of deps) {
        allDeps.add(dep);
      }
    } catch (e) {
      console.warn(`Could not parse ${pkgPath}:`, e);
    }
  }

  // Resolve each dependency to get license and repository info
  const licenses = new Map<string, LicenseInfo>();

  for (const depName of allDeps) {
    const pkgJson = findPackageInNodeModules(monorepoRoot, depName);
    if (!pkgJson) {
      console.warn(`Could not find package.json for ${depName}`);
      continue;
    }

    const version = pkgJson.version ?? 'unknown';
    const key = `${depName}@${version}`;

    if (!licenses.has(key)) {
      const info: LicenseInfo = {
        name: depName,
        version,
        license: extractLicense(pkgJson)
      };

      const repository = extractRepository(pkgJson);
      if (repository) {
        info.repository = repository;
      }

      licenses.set(key, info);
    }
  }

  // Sort by package name
  const sorted = Array.from(licenses.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  // Write output
  const outputPath = path.resolve(import.meta.dirname, '../dist/licenses.json');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(sorted, null, 2));

  console.log(`Generated licenses.json with ${sorted.length} top-level packages`);
}

generateLicenses();
