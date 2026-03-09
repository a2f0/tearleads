import {
  MlsCipherSuite,
  MlsMessageType
} from '@tearleads/shared/gen/tearleads/v2/mls_pb';
import { describe, expect, it } from 'vitest';
import {
  encodeProtoBytes,
  fromProtoMessageType,
  toProtoCipherSuite,
  toProtoGroupState,
  toProtoKeyPackage,
  toProtoMessageType
} from './mlsV2Converters.js';

describe('mlsV2Converters', () => {
  it('maps unknown cipher suites to UNSPECIFIED', () => {
    expect(toProtoCipherSuite(999)).toBe(MlsCipherSuite.UNSPECIFIED);
  });

  it('maps commit/proposal proto message types and fallback', () => {
    expect(fromProtoMessageType(MlsMessageType.COMMIT)).toBe('commit');
    expect(fromProtoMessageType(MlsMessageType.PROPOSAL)).toBe('proposal');
    expect(fromProtoMessageType(MlsMessageType.UNSPECIFIED)).toBe(
      'application'
    );
  });

  it('maps proposal and unknown app message types', () => {
    expect(toProtoMessageType('proposal')).toBe(MlsMessageType.PROPOSAL);
    expect(toProtoMessageType('unknown')).toBe(MlsMessageType.UNSPECIFIED);
  });

  it('encodes and decodes MLS binary fields', () => {
    const bytes = new TextEncoder().encode('ciphertext');
    const encoded = encodeProtoBytes(bytes);
    expect(encoded).toBe(Buffer.from(bytes).toString('base64'));

    const converted = toProtoGroupState({
      id: 'state-1',
      groupId: 'group-1',
      epoch: 2,
      encryptedState: encoded,
      stateHash: 'hash',
      createdAt: '2024-01-01T00:00:00.000Z'
    });

    expect(converted.encryptedState).toEqual(bytes);
  });

  it('rejects invalid base64 direct payloads', () => {
    expect(() =>
      toProtoGroupState({
        id: 'state-1',
        groupId: 'group-1',
        epoch: 2,
        encryptedState: 'not-base64***',
        stateHash: 'hash',
        createdAt: '2024-01-01T00:00:00.000Z'
      })
    ).toThrow('encryptedState must be valid base64');
  });

  it('maps key package payloads to bytes', () => {
    const converted = toProtoKeyPackage({
      id: 'kp-1',
      userId: 'user-1',
      keyPackageData: Buffer.from('kp-data', 'utf8').toString('base64'),
      keyPackageRef: 'ref-1',
      cipherSuite: 3,
      createdAt: '2024-01-01T00:00:00.000Z',
      consumed: false
    });

    expect(converted.keyPackageData).toEqual(
      new TextEncoder().encode('kp-data')
    );
  });
});
