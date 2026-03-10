import { readdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..', '..');
const protoVersionsPath = resolve(repoRoot, 'proto', 'tearleads');
const generatedVersionsPath = resolve(
  repoRoot,
  'packages',
  'shared',
  'src',
  'gen',
  'tearleads'
);

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

async function readDirectoryNames(pathname: string): Promise<Set<string>> {
  try {
    const entries = await readdir(pathname, { withFileTypes: true });
    return new Set(
      entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
    );
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') {
      return new Set();
    }

    throw error;
  }
}

const protoVersions = await readDirectoryNames(protoVersionsPath);
const generatedVersions = await readDirectoryNames(generatedVersionsPath);
const staleGeneratedVersions = [...generatedVersions]
  .filter((version) => !protoVersions.has(version))
  .sort((left, right) => left.localeCompare(right));

for (const version of staleGeneratedVersions) {
  await rm(resolve(generatedVersionsPath, version), {
    force: true,
    recursive: true
  });
}

if (staleGeneratedVersions.length > 0) {
  console.log(
    `pruneStaleGeneratedProtoVersions: removed stale generated directories: ${staleGeneratedVersions.join(', ')}`
  );
}
