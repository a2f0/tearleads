import { Code, ConnectError } from '@connectrpc/connect';
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

  it('throws on invalid base64 payloads from direct handlers', () => {
    try {
      toProtoGroupState({
        id: 'state-1',
        groupId: 'group-1',
        epoch: 2,
        encryptedState: 'not-base64***',
        stateHash: 'hash',
        createdAt: '2024-01-01T00:00:00.000Z'
      });
      throw new Error('expected conversion to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(ConnectError);
      if (!(error instanceof ConnectError)) {
        throw error;
      }
      expect(error.message).toContain(
        'Invalid base64 encryptedState payload from direct service'
      );
      expect(error.code).toBe(Code.Internal);
    }
  });
});
