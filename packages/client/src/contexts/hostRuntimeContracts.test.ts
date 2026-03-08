import type { ContactsProviderProps } from '@tearleads/contacts';
import type {
  HostRuntimeDatabaseState,
  HostRuntimeNavigateOptions
} from '@tearleads/shared';
import type {
  NavigateToNoteOptions,
  NotesProviderProps
} from '@tearleads/notes';
import { describe, expectTypeOf, it } from 'vitest';

describe('host runtime contracts', () => {
  it('keeps notes and contacts database runtime shape aligned', () => {
    expectTypeOf<NotesProviderProps['databaseState']>().toEqualTypeOf<
      HostRuntimeDatabaseState
    >();
    expectTypeOf<ContactsProviderProps['databaseState']>().toEqualTypeOf<
      HostRuntimeDatabaseState
    >();
  });

  it('keeps navigation options aligned with shared runtime contract', () => {
    type ContactsNavigateOptions = Parameters<
      ContactsProviderProps['navigateWithFrom']
    >[1];
    expectTypeOf<ContactsNavigateOptions>().toEqualTypeOf<
      HostRuntimeNavigateOptions | undefined
    >();
    expectTypeOf<NavigateToNoteOptions>().toEqualTypeOf<
      Pick<HostRuntimeNavigateOptions, 'fromLabel'>
    >();
  });
});
