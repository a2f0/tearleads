import { describe, expect, it } from 'vitest';
import { selectActiveSigningKey, type TeeSigningKeyConfig } from './index.js';

describe('key rotation support', () => {
  const primaryKey: TeeSigningKeyConfig = {
    keyId: 'primary',
    privateKeyPem: 'primary-pem'
  };

  const secondaryKey: TeeSigningKeyConfig = {
    keyId: 'secondary',
    privateKeyPem: 'secondary-pem',
    activatedAt: new Date('2026-01-15T00:00:00.000Z')
  };

  const deprecatedKey: TeeSigningKeyConfig = {
    keyId: 'old',
    privateKeyPem: 'old-pem',
    activatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deprecatedAt: new Date('2026-01-10T00:00:00.000Z')
  };

  it('selects the only available key when single key configured', () => {
    const now = new Date('2026-01-05T00:00:00.000Z');
    const selected = selectActiveSigningKey([primaryKey], 3600, now);
    expect(selected.keyId).toBe('primary');
  });

  it('selects the most recently activated non-deprecated key', () => {
    const now = new Date('2026-01-20T00:00:00.000Z');
    const keys = [primaryKey, secondaryKey];
    const selected = selectActiveSigningKey(keys, 3600, now);
    expect(selected.keyId).toBe('secondary');
  });

  it('excludes keys not yet activated', () => {
    const now = new Date('2026-01-10T00:00:00.000Z');
    const futureKey: TeeSigningKeyConfig = {
      keyId: 'future',
      privateKeyPem: 'future-pem',
      activatedAt: new Date('2026-02-01T00:00:00.000Z')
    };
    const keys = [primaryKey, futureKey];
    const selected = selectActiveSigningKey(keys, 3600, now);
    expect(selected.keyId).toBe('primary');
  });

  it('allows deprecated key during grace window', () => {
    const graceWindowSeconds = 3600;
    const now = new Date('2026-01-10T00:30:00.000Z');
    const keys = [deprecatedKey];
    const selected = selectActiveSigningKey(keys, graceWindowSeconds, now);
    expect(selected.keyId).toBe('old');
  });

  it('excludes deprecated key after grace window expires', () => {
    const graceWindowSeconds = 3600;
    const now = new Date('2026-01-10T02:00:00.000Z');
    const keys = [deprecatedKey, primaryKey];
    const selected = selectActiveSigningKey(keys, graceWindowSeconds, now);
    expect(selected.keyId).toBe('primary');
  });

  it('throws error when no active keys available', () => {
    const graceWindowSeconds = 3600;
    const now = new Date('2026-01-10T02:00:00.000Z');
    const keys = [deprecatedKey];
    expect(() => selectActiveSigningKey(keys, graceWindowSeconds, now)).toThrow(
      'No active signing keys available'
    );
  });

  it('throws error when no keys configured', () => {
    const now = new Date('2026-01-05T00:00:00.000Z');
    expect(() => selectActiveSigningKey([], 3600, now)).toThrow(
      'No signing keys configured'
    );
  });

  it('prefers non-deprecated key over deprecated key in grace window', () => {
    const graceWindowSeconds = 3600;
    const now = new Date('2026-01-10T00:30:00.000Z');
    const keys = [deprecatedKey, primaryKey];
    const selected = selectActiveSigningKey(keys, graceWindowSeconds, now);
    expect(selected.keyId).toBe('primary');
  });

  it('uses deprecated key when all keys are deprecated but within grace', () => {
    const graceWindowSeconds = 3600;
    const now = new Date('2026-01-10T00:30:00.000Z');
    const allDeprecated: TeeSigningKeyConfig[] = [
      {
        keyId: 'dep1',
        privateKeyPem: 'dep1-pem',
        activatedAt: new Date('2026-01-01T00:00:00.000Z'),
        deprecatedAt: new Date('2026-01-10T00:00:00.000Z')
      },
      {
        keyId: 'dep2',
        privateKeyPem: 'dep2-pem',
        activatedAt: new Date('2026-01-05T00:00:00.000Z'),
        deprecatedAt: new Date('2026-01-10T00:00:00.000Z')
      }
    ];
    const selected = selectActiveSigningKey(
      allDeprecated,
      graceWindowSeconds,
      now
    );
    expect(selected.keyId).toBe('dep2');
  });
});
