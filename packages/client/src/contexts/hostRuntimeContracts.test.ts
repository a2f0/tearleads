import type {
  AudioUIProviderProps,
  NavigateToAudioOptions
} from '@tearleads/app-audio';
import type { ContactsProviderProps } from '@tearleads/app-contacts';
import type {
  NavigateToNoteOptions,
  NotesProviderProps
} from '@tearleads/app-notes';
import type { VehiclesRuntimeProviderProps } from '@tearleads/app-vehicles';
import type {
  HostRuntimeDatabaseState,
  HostRuntimeNavigateOptions
} from '@tearleads/shared';
import { describe, expectTypeOf, it } from 'vitest';
import type { VideoPlaylistProviderProps } from '@/video/VideoPlaylistContext';

describe('host runtime contracts', () => {
  it('keeps feature database runtime shapes aligned', () => {
    expectTypeOf<NotesProviderProps['databaseState']>().toEqualTypeOf<
      HostRuntimeDatabaseState | undefined
    >();
    expectTypeOf<ContactsProviderProps['databaseState']>().toEqualTypeOf<
      HostRuntimeDatabaseState | undefined
    >();
    expectTypeOf<
      AudioUIProviderProps['databaseState']
    >().toEqualTypeOf<HostRuntimeDatabaseState>();
    expectTypeOf<
      VideoPlaylistProviderProps['databaseState']
    >().toEqualTypeOf<HostRuntimeDatabaseState>();
    expectTypeOf<
      VehiclesRuntimeProviderProps['databaseState']
    >().toEqualTypeOf<HostRuntimeDatabaseState>();
  });

  it('keeps feature navigation options aligned with shared runtime contract', () => {
    type ContactsNavigateOptions = Parameters<
      ContactsProviderProps['navigateWithFrom']
    >[1];
    expectTypeOf<ContactsNavigateOptions>().toEqualTypeOf<
      HostRuntimeNavigateOptions | undefined
    >();
    expectTypeOf<NavigateToNoteOptions>().toEqualTypeOf<
      Pick<HostRuntimeNavigateOptions, 'fromLabel'>
    >();
    expectTypeOf<NavigateToAudioOptions>().toEqualTypeOf<
      Pick<HostRuntimeNavigateOptions, 'fromLabel'>
    >();
  });
});
