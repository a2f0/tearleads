import type { HostRuntimeDatabaseState } from '@tearleads/shared';
import { describe, expectTypeOf, it } from 'vitest';
import type {
  WalletDatabaseState,
  WalletRuntimeProviderProps
} from './WalletRuntimeContext';

describe('WalletRuntimeContext contract', () => {
  it('aligns runtime database state with shared host runtime contract', () => {
    expectTypeOf<WalletDatabaseState>().toEqualTypeOf<HostRuntimeDatabaseState>();
    expectTypeOf<WalletRuntimeProviderProps['databaseState']>().toEqualTypeOf<
      HostRuntimeDatabaseState | undefined
    >();
  });
});
