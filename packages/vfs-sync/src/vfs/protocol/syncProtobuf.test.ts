import { describe, expect, it } from 'vitest';
import {
  decodeVfsCrdtPushRequestProtobuf,
  encodeVfsCrdtPushRequestProtobuf
} from './syncProtobuf.js';
import { PUSH_REQUEST_TYPE } from './syncProtobufSchema.js';

function createBase64(value: string): string {
  return btoa(value);
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const output = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    output[index] = binary.charCodeAt(index);
  }
  return output;
}

function readRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`expected ${label} to be an object`);
  }
  return value;
}

describe('syncProtobuf envelope bytes behavior', () => {
  it('encodes base64 envelope fields into bytes by default', () => {
    const encryptedPayload = createBase64('ciphertext');
    const encryptionNonce = createBase64('nonce');
    const encryptionAad = createBase64('aad');
    const encryptionSignature = createBase64('sig');

    const encoded = encodeVfsCrdtPushRequestProtobuf({
      clientId: 'desktop',
      operations: [
        {
          opId: 'op-1',
          opType: 'item_upsert',
          itemId: 'item-1',
          replicaId: 'desktop',
          writeId: 1,
          occurredAt: '2026-02-14T00:00:00.000Z',
          encryptedPayload,
          keyEpoch: 3,
          encryptionNonce,
          encryptionAad,
          encryptionSignature
        }
      ]
    });

    const rawPayload = readRecord(
      PUSH_REQUEST_TYPE.toObject(PUSH_REQUEST_TYPE.decode(encoded), {
        longs: Number,
        enums: String,
        defaults: false,
        arrays: true,
        objects: true
      }),
      'protobuf payload'
    );
    const rawOperations = rawPayload['operations'];
    if (!Array.isArray(rawOperations)) {
      throw new Error('expected operations[]');
    }
    const firstOperation = readRecord(rawOperations[0], 'operations[0]');

    expect(firstOperation['encryptedPayload']).toBeUndefined();
    expect(firstOperation['encryptionNonce']).toBeUndefined();
    expect(firstOperation['encryptionAad']).toBeUndefined();
    expect(firstOperation['encryptionSignature']).toBeUndefined();
    expect(firstOperation['encryptedPayloadBytes']).toBeDefined();
    expect(firstOperation['encryptionNonceBytes']).toBeDefined();
    expect(firstOperation['encryptionAadBytes']).toBeDefined();
    expect(firstOperation['encryptionSignatureBytes']).toBeDefined();

    const decoded = readRecord(
      decodeVfsCrdtPushRequestProtobuf(encoded),
      'decoded payload'
    );
    const decodedOperations = decoded['operations'];
    if (!Array.isArray(decodedOperations)) {
      throw new Error('expected decoded operations[]');
    }
    const firstDecodedOperation = readRecord(
      decodedOperations[0],
      'decoded operations[0]'
    );
    expect(firstDecodedOperation['encryptedPayload']).toBe(encryptedPayload);
    expect(firstDecodedOperation['encryptionNonce']).toBe(encryptionNonce);
    expect(firstDecodedOperation['encryptionAad']).toBe(encryptionAad);
    expect(firstDecodedOperation['encryptionSignature']).toBe(
      encryptionSignature
    );
  });

  it('decodes bytes-only envelope fields', () => {
    const encryptedPayload = createBase64('ciphertext');
    const encoded = PUSH_REQUEST_TYPE.encode(
      PUSH_REQUEST_TYPE.create({
        clientId: 'desktop',
        operations: [
          {
            opId: 'op-1',
            opType: 'item_upsert',
            itemId: 'item-1',
            replicaId: 'desktop',
            writeId: 1,
            occurredAt: '2026-02-14T00:00:00.000Z',
            encryptedPayloadBytes: decodeBase64(encryptedPayload),
            keyEpoch: 3
          }
        ]
      })
    ).finish();

    const decoded = readRecord(
      decodeVfsCrdtPushRequestProtobuf(encoded),
      'decoded payload'
    );
    const operations = decoded['operations'];
    if (!Array.isArray(operations)) {
      throw new Error('expected operations[]');
    }
    const firstOperation = readRecord(operations[0], 'operations[0]');
    expect(firstOperation['encryptedPayload']).toBe(encryptedPayload);
  });

  it('rejects invalid base64 envelope payloads on encode', () => {
    expect(() =>
      encodeVfsCrdtPushRequestProtobuf({
        clientId: 'desktop',
        operations: [
          {
            opId: 'op-1',
            opType: 'item_upsert',
            itemId: 'item-1',
            replicaId: 'desktop',
            writeId: 1,
            occurredAt: '2026-02-14T00:00:00.000Z',
            encryptedPayload: 'not-base64***'
          }
        ]
      })
    ).toThrow('invalid protobuf payload field: encryptedPayload');
  });
});
