import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ENVELOPE_BYTEA_READS_FLAG,
  shouldReadEnvelopeBytea
} from './vfsDirectCrdtEnvelopeReadOptions.js';

describe('vfsDirectCrdtEnvelopeReadOptions', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults to true when env is unset', () => {
    expect(shouldReadEnvelopeBytea()).toBe(true);
  });

  it('returns false for supported falsey values', () => {
    for (const value of ['0', 'false', 'no', 'off', '  false  ']) {
      vi.stubEnv(ENVELOPE_BYTEA_READS_FLAG, value);
      expect(shouldReadEnvelopeBytea()).toBe(false);
    }
  });

  it('returns true for supported truthy values and invalid input fallback', () => {
    for (const value of ['1', 'true', 'yes', 'on', '  true  ', 'invalid']) {
      vi.stubEnv(ENVELOPE_BYTEA_READS_FLAG, value);
      expect(shouldReadEnvelopeBytea()).toBe(true);
    }
  });
});
