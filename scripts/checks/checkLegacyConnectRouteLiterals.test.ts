import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findLegacyConnectViolations,
  shouldScanFile
} from './checkLegacyConnectRouteLiterals.ts';

test('shouldScanFile targets runtime files and excludes test files', () => {
  assert.equal(shouldScanFile('packages/api/src/connect/router.ts'), true);
  assert.equal(shouldScanFile('crates/api-v2/src/lib.rs'), true);

  assert.equal(
    shouldScanFile('packages/app-admin/src/lib/api.test.ts'),
    false
  );
  assert.equal(
    shouldScanFile('packages/app-admin/src/lib/api.spec.ts'),
    false
  );
  assert.equal(shouldScanFile('crates/api-v2/tests/admin_service.rs'), true);
  assert.equal(
    shouldScanFile('crates/api-v2/tests/admin_service_test.rs'),
    false
  );
  assert.equal(shouldScanFile('docs/en/api-v2-wave1a-migration-matrix.md'), false);
});

test('findLegacyConnectViolations detects v1 service names and route literals', () => {
  const content = [
    "const name = 'tearleads.v1.AdminService';",
    "const route = '/connect/tearleads.v1.AdminService/ListUsers';",
    "const v2Route = '/connect/tearleads.v2.AdminService/ListUsers';"
  ].join('\n');

  const violations = findLegacyConnectViolations(
    content,
    '/tmp/example-runtime.ts'
  );

  assert.equal(violations.length, 2);
  assert.equal(violations[0]?.line, 1);
  assert.equal(violations[0]?.pattern, 'legacy-service-name');
  assert.equal(violations[1]?.line, 2);
  assert.equal(violations[1]?.pattern, 'legacy-service-name');
});

