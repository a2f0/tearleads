import type { HostRuntimeDatabaseState } from '@tearleads/shared';
import { describe, expectTypeOf, it } from 'vitest';
import type {
  HealthDatabaseState,
  HealthRuntimeProviderProps
} from './HealthRuntimeContext';

describe('HealthRuntimeContext contract', () => {
  it('aligns runtime database state with shared host runtime contract', () => {
    expectTypeOf<HealthDatabaseState>().toEqualTypeOf<HostRuntimeDatabaseState>();
    expectTypeOf<HealthRuntimeProviderProps['databaseState']>().toEqualTypeOf<
      HostRuntimeDatabaseState | undefined
    >();
  });
});
