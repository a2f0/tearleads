import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function hasExpectedBinary(
  pkgJsonPath: string,
  expectedBinary: string
): boolean {
  const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as {
    bin?: string | Record<string, string>;
  };

  if (typeof pkgJson.bin === 'string') {
    return expectedBinary.length > 0;
  }

  if (
    typeof pkgJson.bin === 'object' &&
    pkgJson.bin !== null &&
    expectedBinary in pkgJson.bin
  ) {
    return true;
  }

  return false;
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
if (
  !hasExpectedBinary(protocGenConnectPackageJsonPath, 'protoc-gen-connect-es')
) {
  throw new Error(
    '@connectrpc/protoc-gen-connect-es is installed but missing expected binary protoc-gen-connect-es'
  );
}
