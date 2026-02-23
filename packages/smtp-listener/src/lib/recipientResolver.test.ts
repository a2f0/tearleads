import { describe, expect, it } from 'vitest';
import { resolveRecipientUserIds } from './recipientResolver.js';

describe('resolveRecipientUserIds', () => {
  const uuidA = '11111111-1111-4111-8111-111111111111';
  const uuidB = '22222222-2222-4222-8222-222222222222';

  it('accepts uuid local-parts in uuid-local-part mode', () => {
    expect(
      resolveRecipientUserIds({
        rcptTo: [{ address: `${uuidA}@mail.test.com` }],
        allowedDomains: null,
        recipientAddressing: 'uuid-local-part'
      })
    ).toEqual([uuidA]);
  });

  it('rejects non-uuid local-parts in uuid-local-part mode', () => {
    expect(
      resolveRecipientUserIds({
        rcptTo: [{ address: 'user-1@mail.test.com' }],
        allowedDomains: null,
        recipientAddressing: 'uuid-local-part'
      })
    ).toEqual([]);
  });

  it('accepts non-uuid local-parts in legacy-local-part mode', () => {
    expect(
      resolveRecipientUserIds({
        rcptTo: [{ address: 'user-1@mail.test.com' }],
        allowedDomains: null,
        recipientAddressing: 'legacy-local-part'
      })
    ).toEqual(['user-1']);
  });

  it('filters recipients by allowed domains and deduplicates local-part', () => {
    expect(
      resolveRecipientUserIds({
        rcptTo: [
          { address: `${uuidA}@mail.test.com` },
          { address: `${uuidA}@mail.test.com` },
          { address: `${uuidB}@other.test.com` }
        ],
        allowedDomains: new Set(['mail.test.com']),
        recipientAddressing: 'uuid-local-part'
      })
    ).toEqual([uuidA]);
  });
});
