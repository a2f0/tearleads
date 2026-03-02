import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

interface PackageJsonWithBin {
  name?: string;
  bin?: string | Record<string, string>;
}

function normalizePackageBinaryName(packageName: string): string {
  const slashIndex = packageName.lastIndexOf('/');
  if (slashIndex < 0) {
    return packageName;
  }

  return packageName.slice(slashIndex + 1);
}

function hasExpectedBinary(
  pkgJsonPath: string,
  expectedBinary: string
): boolean {
  const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as PackageJsonWithBin;

  if (typeof pkgJson.bin === 'string') {
    if (typeof pkgJson.name !== 'string' || pkgJson.name.length === 0) {
      return false;
    }
    return normalizePackageBinaryName(pkgJson.name) === expectedBinary;
  }

  return (
    typeof pkgJson.bin === 'object' &&
    pkgJson.bin !== null &&
    expectedBinary in pkgJson.bin
  );
}

const protocGenEsPackageJsonPath = require.resolve(
  '@bufbuild/protoc-gen-es/package.json'
);
if (!hasExpectedBinary(protocGenEsPackageJsonPath, 'protoc-gen-es')) {
  throw new Error(
    '@bufbuild/protoc-gen-es is installed but missing expected binary protoc-gen-es'
  );
}

const protocGenConnectPackageJsonPath = require.resolve(
  '@connectrpc/protoc-gen-connect-es/package.json'
);
if (!hasExpectedBinary(protocGenConnectPackageJsonPath, 'protoc-gen-connect-es')) {
  throw new Error(
    '@connectrpc/protoc-gen-connect-es is installed but missing expected binary protoc-gen-connect-es'
  );
}
