import type { HostRuntimeDatabaseState } from '@tearleads/shared';
import { describe, expectTypeOf, it } from 'vitest';
import type { DatabaseState, NotesProviderProps } from './NotesContext';

describe('NotesContext contract', () => {
  it('aligns runtime database state with shared host runtime contract', () => {
    expectTypeOf<DatabaseState>().toEqualTypeOf<HostRuntimeDatabaseState>();
    expectTypeOf<NotesProviderProps['databaseState']>().toEqualTypeOf<
      HostRuntimeDatabaseState | undefined
    >();
  });
});
