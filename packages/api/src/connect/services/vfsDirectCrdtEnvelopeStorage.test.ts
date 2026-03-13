import { describe, expect, it } from 'vitest';
import { serializeEnvelopeField } from './vfsDirectCrdtEnvelopeStorage.js';

describe('vfsDirectCrdtEnvelopeStorage', () => {
  const bytes = Uint8Array.from(Buffer.from('abc'));

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
      Buffer.from(bytes).toString('base64')
    );
    expect(serialized.text).toBeNull();
    expect(serialized.bytes).toEqual(bytes);
  });

  it('falls back to text for non-base64 values', () => {
    const serialized = serializeEnvelopeField('not@base64@value');
    expect(serialized).toEqual({
      text: 'not@base64@value',
      bytes: null
    });
  });

  it('stores Uint8Array inputs as bytea values', () => {
    const serialized = serializeEnvelopeField(
      Uint8Array.from(Buffer.from('payload'))
    );
    expect(serialized.text).toBeNull();
    expect(serialized.bytes).toEqual(Uint8Array.from(Buffer.from('payload')));
  });
});
