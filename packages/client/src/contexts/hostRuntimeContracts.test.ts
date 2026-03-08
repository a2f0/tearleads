import type {
  TranslationFunction as AITranslationFunction,
  AITranslationKey,
  AIUIProviderProps
} from '@tearleads/ai';
import type {
  AudioUIProviderProps,
  NavigateToAudioOptions
} from '@tearleads/audio';
import type { ContactsProviderProps } from '@tearleads/contacts';
import type {
  NavigateToNoteOptions,
  NotesProviderProps
} from '@tearleads/notes';
import type {
  HostRuntimeDatabaseState,
  HostRuntimeNavigateOptions,
  HostRuntimeTranslation
} from '@tearleads/shared';
import type { VfsExplorerProviderProps } from '@tearleads/vfs-explorer';
import { describe, expectTypeOf, it } from 'vitest';
import type { VideoPlaylistProviderProps } from '@/video/VideoPlaylistContext';

describe('host runtime contracts', () => {
  it('keeps feature database runtime shapes aligned', () => {
    expectTypeOf<
      NotesProviderProps['databaseState']
    >().toEqualTypeOf<HostRuntimeDatabaseState>();
    expectTypeOf<
      ContactsProviderProps['databaseState']
    >().toEqualTypeOf<HostRuntimeDatabaseState>();
    expectTypeOf<
      AudioUIProviderProps['databaseState']
    >().toEqualTypeOf<HostRuntimeDatabaseState>();
    expectTypeOf<
      VideoPlaylistProviderProps['databaseState']
    >().toEqualTypeOf<HostRuntimeDatabaseState>();
    expectTypeOf<
      AIUIProviderProps['databaseState']
    >().toEqualTypeOf<HostRuntimeDatabaseState>();
    expectTypeOf<
      VfsExplorerProviderProps['databaseState']
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

  it('keeps feature translation function signatures aligned', () => {
    expectTypeOf<AITranslationFunction>().toEqualTypeOf<
      HostRuntimeTranslation<AITranslationKey>
    >();
  });
});
