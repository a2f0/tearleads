import type { HostRuntimeDatabaseState } from '@tearleads/shared';
import { describe, expectTypeOf, it } from 'vitest';
import type { ContactsProviderProps, DatabaseState } from './ContactsContext';

describe('ContactsContext contract', () => {
  it('aligns runtime database state with shared host runtime contract', () => {
    expectTypeOf<DatabaseState>().toEqualTypeOf<HostRuntimeDatabaseState>();
    expectTypeOf<ContactsProviderProps['databaseState']>().toEqualTypeOf<HostRuntimeDatabaseState>();
  });
});
