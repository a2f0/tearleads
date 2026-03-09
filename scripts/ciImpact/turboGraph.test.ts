import assert from 'node:assert/strict';
import test from 'node:test';
import { loadWorkspaceGraph, parseTurboQueryResponse } from './turboGraph.ts';

const VALID_TURBO_RESPONSE = JSON.stringify({
  data: {
    packages: {
      items: [
        {
          name: '//',
          path: '',
          directDependents: { items: [] }
        },
        {
          name: '@example/core',
          path: 'packages/core',
          directDependents: { items: [{ name: '@example/app' }] }
        },
        {
          name: '@example/app',
          path: 'packages/app',
          directDependents: { items: [{ name: '//' }] }
        }
      ]
    }
  }
});

test('parseTurboQueryResponse parses valid turbo output', () => {
  const items = parseTurboQueryResponse(VALID_TURBO_RESPONSE);
  assert.equal(items.length, 3);
  assert.equal(items[0]?.name, '//');
  assert.equal(items[1]?.name, '@example/core');
  assert.equal(items[1]?.path, 'packages/core');
  assert.deepEqual(items[1]?.directDependents.items, [
    { name: '@example/app' }
  ]);
});

test('parseTurboQueryResponse rejects non-object root', () => {
  assert.throws(() => parseTurboQueryResponse('"string"'), {
    message: /expected object at root/
  });
});

test('parseTurboQueryResponse rejects missing data', () => {
  assert.throws(() => parseTurboQueryResponse('{}'), {
    message: /missing data$/
  });
});

test('parseTurboQueryResponse rejects missing items array', () => {
  assert.throws(
    () =>
      parseTurboQueryResponse(
        JSON.stringify({ data: { packages: { items: 'not-array' } } })
      ),
    { message: /missing data\.packages\.items/ }
  );
});

test('parseTurboQueryResponse rejects item missing name', () => {
  assert.throws(
    () =>
      parseTurboQueryResponse(
        JSON.stringify({
          data: {
            packages: {
              items: [{ path: 'x', directDependents: { items: [] } }]
            }
          }
        })
      ),
    { message: /missing name or path/ }
  );
});

test('root package // is filtered from lookup and reverse graph', () => {
  const { lookup, reverseGraph } = loadWorkspaceGraph();
  assert.equal(lookup.byName.has('//'), false);
  assert.equal(reverseGraph.has('//'), false);
  for (const dependents of reverseGraph.values()) {
    assert.equal(dependents.has('//'), false);
  }
});

test('loadWorkspaceGraph returns valid lookup and reverse graph', () => {
  const { lookup, reverseGraph } = loadWorkspaceGraph();
  assert.ok(lookup.byName.size > 0, 'byName should have entries');
  assert.ok(lookup.byDir.size > 0, 'byDir should have entries');
  assert.ok(reverseGraph.size > 0, 'reverseGraph should have entries');
  for (const [name, pkg] of lookup.byName.entries()) {
    assert.equal(name, pkg.name, 'byName key should match package name');
    assert.equal(
      lookup.byDir.get(pkg.dir),
      name,
      'byDir should map dir back to name'
    );
  }
});
