import { afterEach, describe, expect, it, vi } from 'vitest';
import { serializeEnvelopeField } from './crdtEnvelopeStorage.js';

describe('crdtEnvelopeStorage', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns null storage values for empty inputs', () => {
    expect(serializeEnvelopeField(undefined)).toEqual({
      text: null,
      bytes: null
    });
    expect(serializeEnvelopeField(null)).toEqual({
      text: null,
      bytes: null
    });
    expect(serializeEnvelopeField('   ')).toEqual({
      text: null,
      bytes: null
    });
  });

  it('stores valid base64 as bytea by default', () => {
    const serialized = serializeEnvelopeField(
      Buffer.from('abc').toString('base64')
    );
    expect(serialized.text).toBeNull();
    expect(serialized.bytes).toEqual(Buffer.from('abc'));
  });

  it('falls back to text for non-base64 values', () => {
    const serialized = serializeEnvelopeField('not@base64@value');
    expect(serialized).toEqual({
      text: 'not@base64@value',
      bytes: null
    });
  });

  it('supports disabling bytea writes via env flag', () => {
    vi.stubEnv('VFS_CRDT_ENVELOPE_BYTEA_WRITES', 'false');

    const serialized = serializeEnvelopeField(
      Buffer.from('abc').toString('base64')
    );
    expect(serialized).toEqual({
      text: Buffer.from('abc').toString('base64'),
      bytes: null
    });
  });

  it('supports dual-writing text when bytea writes are enabled', () => {
    vi.stubEnv('VFS_CRDT_ENVELOPE_DUAL_WRITE_TEXT', 'true');

    const serialized = serializeEnvelopeField(
      Buffer.from('abc').toString('base64')
    );
    expect(serialized.text).toBe(Buffer.from('abc').toString('base64'));
    expect(serialized.bytes).toEqual(Buffer.from('abc'));
  });
});
