import type { HostRuntimeDatabaseState } from '@tearleads/shared';
import { describe, expectTypeOf, it } from 'vitest';
import type {
  BusinessesDatabaseState,
  BusinessesProviderProps
} from './BusinessesContext';

describe('BusinessesContext contract', () => {
  it('aligns runtime database state with shared host runtime contract', () => {
    expectTypeOf<BusinessesDatabaseState>().toEqualTypeOf<HostRuntimeDatabaseState>();
    expectTypeOf<BusinessesProviderProps['databaseState']>().toEqualTypeOf<
      HostRuntimeDatabaseState | undefined
    >();
  });
});
