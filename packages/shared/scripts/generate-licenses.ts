import fs from 'node:fs';
import path from 'node:path';

interface PackageJson {
  name?: string;
  version?: string;
  license?: string | { type: string };
  licenses?: Array<{ type: string }>;
  repository?: string | { type: string; url: string };
}

interface LicenseInfo {
  name: string;
  version: string;
  license: string;
}

function extractLicense(pkg: PackageJson): string {
  // Handle standard string license (including SPDX expressions like "(MIT OR Apache-2.0)")
  if (typeof pkg.license === 'string') return pkg.license;

  // Handle object format { type: "MIT" }
  if (pkg.license && typeof pkg.license === 'object' && pkg.license.type) {
    return pkg.license.type;
  }

  // Handle deprecated licenses array format
  if (Array.isArray(pkg.licenses) && pkg.licenses.length > 0) {
    return pkg.licenses.map((l) => l.type).join(' OR ');
  }

  return 'Unknown';
}

function walkNodeModules(
  dir: string,
  licenses: Map<string, LicenseInfo>,
  prefix = ''
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const fullPath = path.join(dir, entry.name);

    // Handle scoped packages (@org/package)
    if (entry.name.startsWith('@')) {
      walkNodeModules(fullPath, licenses, entry.name + '/');
      continue;
    }

    // Check for package.json
    const pkgJsonPath = path.join(fullPath, 'package.json');
    if (!fs.existsSync(pkgJsonPath)) continue;

    try {
      const pkgJson: PackageJson = JSON.parse(
        fs.readFileSync(pkgJsonPath, 'utf-8')
      );

      const name = prefix + entry.name;
      const version = pkgJson.version ?? 'unknown';
      const key = `${name}@${version}`;

      if (!licenses.has(key)) {
        licenses.set(key, {
          name,
          version,
          license: extractLicense(pkgJson)
        });
      }
    } catch (e) {
      console.warn(`Could not parse ${pkgJsonPath}:`, e);
    }
  }
}

function generateLicenses(): void {
  const monorepoRoot = path.resolve(import.meta.dirname, '../../..');
  const pnpmDir = path.join(monorepoRoot, 'node_modules/.pnpm');

  if (!fs.existsSync(pnpmDir)) {
    console.error('Error: node_modules/.pnpm not found. Run pnpm install first.');
    process.exit(1);
  }

  const licenses = new Map<string, LicenseInfo>();

  // Read all package directories in .pnpm
  const entries = fs.readdirSync(pnpmDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    // Find package.json files in node_modules subdirectories
    const nodeModulesPath = path.join(pnpmDir, entry.name, 'node_modules');
    if (!fs.existsSync(nodeModulesPath)) continue;

    walkNodeModules(nodeModulesPath, licenses);
  }

  // Sort by package name
  const sorted = Array.from(licenses.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  // Write output
  const outputPath = path.resolve(import.meta.dirname, '../dist/licenses.json');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(sorted, null, 2));

  console.log(`Generated licenses.json with ${sorted.length} packages`);
}

generateLicenses();
