import { describe, expect, it } from 'vitest';
import type { VfsCrdtOperation } from '../protocol/sync-crdt.js';
import {
  encodeWriteIdRecord,
  toCompactOperation,
  toPackedIdBase64
} from './syncHttpTransportPayloadEncoding.js';

describe('toPackedIdBase64', () => {
  it('encodes a UUID to packed base64', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    const result = toPackedIdBase64(uuid);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    expect(result).not.toBe(uuid);
  });

  it('encodes a non-UUID string to base64', () => {
    const result = toPackedIdBase64('replica-1');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('encodeWriteIdRecord', () => {
  it('passes through valid write IDs', () => {
    const result = encodeWriteIdRecord({ 'replica-1': 5, 'replica-2': 10 });
    expect(result).toEqual({ 'replica-1': 5, 'replica-2': 10 });
  });

  it('returns empty object for empty input', () => {
    expect(encodeWriteIdRecord({})).toEqual({});
  });

  it('rejects NaN write ID', () => {
    expect(() => encodeWriteIdRecord({ 'replica-1': NaN })).toThrow(
      'must be a safe integer'
    );
  });

  it('rejects zero write ID', () => {
    expect(() => encodeWriteIdRecord({ 'replica-1': 0 })).toThrow(
      'must be a safe integer'
    );
  });

  it('rejects negative write ID', () => {
    expect(() => encodeWriteIdRecord({ 'replica-1': -1 })).toThrow(
      'must be a safe integer'
    );
  });

  it('rejects non-integer write ID', () => {
    expect(() => encodeWriteIdRecord({ 'replica-1': 1.5 })).toThrow(
      'must be a safe integer'
    );
  });
});

describe('toCompactOperation', () => {
  const baseOperation: VfsCrdtOperation = {
    opId: '550e8400-e29b-41d4-a716-446655440000',
    opType: 'item_upsert',
    itemId: '660e8400-e29b-41d4-a716-446655440001',
    replicaId: '770e8400-e29b-41d4-a716-446655440002',
    writeId: 1,
    occurredAt: '2026-01-01T00:00:00.000Z'
  };

  it('encodes identifiers to packed base64', () => {
    const result = toCompactOperation(baseOperation);
    expect(result['opId']).not.toBe(baseOperation.opId);
    expect(typeof result['opId']).toBe('string');
    expect(result['itemId']).not.toBe(baseOperation.itemId);
    expect(result['replicaId']).not.toBe(baseOperation.replicaId);
  });

  it('encodes opType to connect JSON enum', () => {
    const result = toCompactOperation(baseOperation);
    expect(result['opType']).toBe('VFS_CRDT_OP_TYPE_ITEM_UPSERT');
  });

  it('encodes writeId as string', () => {
    const result = toCompactOperation(baseOperation);
    expect(result['writeId']).toBe('1');
  });

  it('encodes occurredAtMs as string', () => {
    const result = toCompactOperation(baseOperation);
    expect(result['occurredAtMs']).toBe(
      String(Date.parse('2026-01-01T00:00:00.000Z'))
    );
  });

  it('rejects invalid occurredAt timestamp', () => {
    expect(() =>
      toCompactOperation({ ...baseOperation, occurredAt: 'not-a-date' })
    ).toThrow('must be a valid ISO timestamp');
  });

  it('rejects zero writeId', () => {
    expect(() =>
      toCompactOperation({ ...baseOperation, writeId: 0 })
    ).toThrow('must be a safe integer');
  });

  it('includes optional ACL fields when present', () => {
    const result = toCompactOperation({
      ...baseOperation,
      principalType: 'user',
      principalId: '880e8400-e29b-41d4-a716-446655440003',
      accessLevel: 'write'
    });
    expect(result['principalType']).toBe('VFS_ACL_PRINCIPAL_TYPE_USER');
    expect(typeof result['principalId']).toBe('string');
    expect(result['accessLevel']).toBe('VFS_ACL_ACCESS_LEVEL_WRITE');
  });

  it('includes optional link fields when present', () => {
    const result = toCompactOperation({
      ...baseOperation,
      parentId: '990e8400-e29b-41d4-a716-446655440004',
      childId: 'aa0e8400-e29b-41d4-a716-446655440005'
    });
    expect(typeof result['parentId']).toBe('string');
    expect(typeof result['childId']).toBe('string');
  });

  it('omits optional fields when not present', () => {
    const result = toCompactOperation(baseOperation);
    expect(result).not.toHaveProperty('principalType');
    expect(result).not.toHaveProperty('principalId');
    expect(result).not.toHaveProperty('accessLevel');
    expect(result).not.toHaveProperty('parentId');
    expect(result).not.toHaveProperty('childId');
  });
});
