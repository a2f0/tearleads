import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findProtoCodegenParityIssues,
  type ProtoDefinition
} from './checkProtoCodegenParity.ts';

test('findProtoCodegenParityIssues reports missing service artifacts', () => {
  const definitions: ProtoDefinition[] = [
    { basename: 'auth', hasService: true },
    { basename: 'common', hasService: false }
  ];
  const generatedArtifacts = new Set(['auth_pb.ts', 'common_pb.ts']);

  const issues = findProtoCodegenParityIssues(definitions, generatedArtifacts);

  assert.deepEqual(issues.missing, ['auth_connect.ts']);
  assert.deepEqual(issues.stale, []);
});

test('findProtoCodegenParityIssues reports stale artifacts', () => {
  const definitions: ProtoDefinition[] = [{ basename: 'auth', hasService: true }];
  const generatedArtifacts = new Set([
    'auth_connect.ts',
    'auth_pb.ts',
    'legacy_connect.ts',
    'legacy_pb.ts'
  ]);

  const issues = findProtoCodegenParityIssues(definitions, generatedArtifacts);

  assert.deepEqual(issues.missing, []);
  assert.deepEqual(issues.stale, ['legacy_connect.ts', 'legacy_pb.ts']);
});

test('findProtoCodegenParityIssues returns no issues when parity matches', () => {
  const definitions: ProtoDefinition[] = [
    { basename: 'auth', hasService: true },
    { basename: 'common', hasService: false }
  ];
  const generatedArtifacts = new Set([
    'auth_connect.ts',
    'auth_pb.ts',
    'common_pb.ts'
  ]);

  const issues = findProtoCodegenParityIssues(definitions, generatedArtifacts);

  assert.deepEqual(issues.missing, []);
  assert.deepEqual(issues.stale, []);
});
