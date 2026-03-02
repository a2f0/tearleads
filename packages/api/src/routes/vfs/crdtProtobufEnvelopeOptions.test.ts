import { afterEach, describe, expect, it, vi } from 'vitest';
import { shouldIncludeLegacyCrdtProtobufEnvelopeStrings } from './crdtProtobufEnvelopeOptions.js';

const LEGACY_PROTOBUF_ENVELOPE_FIELDS_FLAG =
  'VFS_CRDT_PROTOBUF_INCLUDE_LEGACY_ENVELOPE_STRINGS';

describe('crdtProtobufEnvelopeOptions', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults to false when env is unset', () => {
    expect(shouldIncludeLegacyCrdtProtobufEnvelopeStrings()).toBe(false);
  });

  it('returns true for supported truthy values', () => {
    for (const value of ['1', 'true', 'yes', 'on', '  TrUe  ']) {
      vi.stubEnv(LEGACY_PROTOBUF_ENVELOPE_FIELDS_FLAG, value);
      expect(shouldIncludeLegacyCrdtProtobufEnvelopeStrings()).toBe(true);
    }
  });

  it('returns false for supported falsy values', () => {
    for (const value of ['0', 'false', 'no', 'off', '  fAlSe  ']) {
      vi.stubEnv(LEGACY_PROTOBUF_ENVELOPE_FIELDS_FLAG, value);
      expect(shouldIncludeLegacyCrdtProtobufEnvelopeStrings()).toBe(false);
    }
  });

  it('falls back to default false for unrecognized values', () => {
    vi.stubEnv(LEGACY_PROTOBUF_ENVELOPE_FIELDS_FLAG, 'maybe');
    expect(shouldIncludeLegacyCrdtProtobufEnvelopeStrings()).toBe(false);
  });
});
