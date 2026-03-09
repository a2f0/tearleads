import type { HostRuntimeDatabaseState } from '@tearleads/shared';
import { describe, expectTypeOf, it } from 'vitest';
import type { EmailDatabaseState, EmailProviderProps } from './EmailContext';

describe('EmailContext contract', () => {
  it('aligns runtime database state with shared host runtime contract', () => {
    expectTypeOf<EmailDatabaseState>().toEqualTypeOf<HostRuntimeDatabaseState>();
    expectTypeOf<EmailProviderProps['databaseState']>().toEqualTypeOf<
      HostRuntimeDatabaseState | undefined
    >();
  });
});
