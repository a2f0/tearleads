import { ed25519 } from '@noble/curves/ed25519.js';
import { describe, expect, it } from 'vitest';
import {
  canonicalizeAclOperation,
  signAclOperation,
  verifyAclOperationSignature
} from './aclOperationSigning.js';

const SAMPLE_FIELDS = {
  opId: '550e8400-e29b-41d4-a716-446655440000',
  opType: 'acl_add',
  itemId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
  replicaId: 'desktop-client',
  writeId: 42,
  occurredAt: '2026-03-01T12:00:00.000Z',
  principalType: 'user',
  principalId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  accessLevel: 'write'
};

describe('canonicalizeAclOperation', () => {
  it('produces deterministic output for the same input', () => {
    const a = canonicalizeAclOperation(SAMPLE_FIELDS);
    const b = canonicalizeAclOperation(SAMPLE_FIELDS);
    expect(a).toEqual(b);
  });

  it('produces different output for different fields', () => {
    const a = canonicalizeAclOperation(SAMPLE_FIELDS);
    const b = canonicalizeAclOperation({
      ...SAMPLE_FIELDS,
      accessLevel: 'admin'
    });
    expect(a).not.toEqual(b);
  });

  it('starts with version byte', () => {
    const bytes = canonicalizeAclOperation(SAMPLE_FIELDS);
    expect(bytes[0]).toBe(1);
  });

  it('encodes all 9 fields with length prefixes', () => {
    const bytes = canonicalizeAclOperation(SAMPLE_FIELDS);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    let offset = 1;
    const decoder = new TextDecoder();
    const values: string[] = [];
    while (offset < bytes.length) {
      const len = view.getUint32(offset, false);
      offset += 4;
      const field = decoder.decode(bytes.subarray(offset, offset + len));
      values.push(field);
      offset += len;
    }

    expect(values).toEqual([
      SAMPLE_FIELDS.opId,
      SAMPLE_FIELDS.opType,
      SAMPLE_FIELDS.itemId,
      SAMPLE_FIELDS.replicaId,
      String(SAMPLE_FIELDS.writeId),
      SAMPLE_FIELDS.occurredAt,
      SAMPLE_FIELDS.principalType,
      SAMPLE_FIELDS.principalId,
      SAMPLE_FIELDS.accessLevel
    ]);
  });

  it('is sensitive to field ordering (different writeId changes bytes)', () => {
    const a = canonicalizeAclOperation(SAMPLE_FIELDS);
    const b = canonicalizeAclOperation({ ...SAMPLE_FIELDS, writeId: 43 });
    expect(a).not.toEqual(b);
  });
});

describe('signAclOperation / verifyAclOperationSignature', () => {
  const privateKey = ed25519.utils.randomSecretKey();
  const publicKey = ed25519.getPublicKey(privateKey);

  it('produces a valid base64 signature', () => {
    const sig = signAclOperation(SAMPLE_FIELDS, privateKey);
    expect(typeof sig).toBe('string');
    expect(sig.length).toBeGreaterThan(0);
    expect(() => atob(sig)).not.toThrow();
  });

  it('signature verifies with matching public key', () => {
    const sig = signAclOperation(SAMPLE_FIELDS, privateKey);
    const valid = verifyAclOperationSignature(SAMPLE_FIELDS, sig, publicKey);
    expect(valid).toBe(true);
  });

  it('signature fails with wrong public key', () => {
    const otherPrivate = ed25519.utils.randomSecretKey();
    const otherPublic = ed25519.getPublicKey(otherPrivate);
    const sig = signAclOperation(SAMPLE_FIELDS, privateKey);
    const valid = verifyAclOperationSignature(SAMPLE_FIELDS, sig, otherPublic);
    expect(valid).toBe(false);
  });

  it('signature fails with tampered fields', () => {
    const sig = signAclOperation(SAMPLE_FIELDS, privateKey);
    const tampered = { ...SAMPLE_FIELDS, accessLevel: 'admin' };
    const valid = verifyAclOperationSignature(tampered, sig, publicKey);
    expect(valid).toBe(false);
  });

  it('signature fails with invalid base64', () => {
    const valid = verifyAclOperationSignature(
      SAMPLE_FIELDS,
      'not-valid-base64!!!',
      publicKey
    );
    expect(valid).toBe(false);
  });

  it('deterministic: same input produces same signature', () => {
    const sig1 = signAclOperation(SAMPLE_FIELDS, privateKey);
    const sig2 = signAclOperation(SAMPLE_FIELDS, privateKey);
    expect(sig1).toBe(sig2);
  });
});
