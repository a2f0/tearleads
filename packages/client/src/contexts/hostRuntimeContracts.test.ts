import type { AIUIProviderProps } from '@tearleads/app-ai';
import type {
  AudioUIProviderProps,
  NavigateToAudioOptions
} from '@tearleads/app-audio';
import type { BusinessesProviderProps } from '@tearleads/app-businesses';
import type { CalendarUIProviderProps } from '@tearleads/app-calendar';
import type { ContactsProviderProps } from '@tearleads/app-contacts';
import type { EmailProviderProps } from '@tearleads/app-email';
import type { HealthRuntimeProviderProps } from '@tearleads/app-health/clientEntry';
import type {
  NavigateToNoteOptions,
  NotesProviderProps
} from '@tearleads/app-notes';
import type { VehiclesRuntimeProviderProps } from '@tearleads/app-vehicles';
import type { WalletRuntimeProviderProps } from '@tearleads/app-wallet/clientEntry';
import type {
  HostRuntimeBaseProps,
  HostRuntimeDatabaseState,
  HostRuntimeNavigateOptions
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
      AIUIProviderProps['databaseState']
    >().toEqualTypeOf<HostRuntimeDatabaseState>();
    expectTypeOf<
      VideoPlaylistProviderProps['databaseState']
    >().toEqualTypeOf<HostRuntimeDatabaseState>();
    expectTypeOf<
      VfsExplorerProviderProps['databaseState']
    >().toEqualTypeOf<HostRuntimeDatabaseState>();
    expectTypeOf<
      VehiclesRuntimeProviderProps['databaseState']
    >().toEqualTypeOf<HostRuntimeDatabaseState>();
    expectTypeOf<
      HealthRuntimeProviderProps['databaseState']
    >().toEqualTypeOf<HostRuntimeDatabaseState>();
    expectTypeOf<
      WalletRuntimeProviderProps['databaseState']
    >().toEqualTypeOf<HostRuntimeDatabaseState>();
    expectTypeOf<
      BusinessesProviderProps['databaseState']
    >().toEqualTypeOf<HostRuntimeDatabaseState>();
    expectTypeOf<
      EmailProviderProps['databaseState']
    >().toEqualTypeOf<HostRuntimeDatabaseState>();
    expectTypeOf<
      CalendarUIProviderProps['databaseState']
    >().toEqualTypeOf<HostRuntimeDatabaseState>();
  });

  it('all feature provider props extend HostRuntimeBaseProps', () => {
    expectTypeOf<NotesProviderProps>().toMatchTypeOf<HostRuntimeBaseProps>();
    expectTypeOf<ContactsProviderProps>().toMatchTypeOf<HostRuntimeBaseProps>();
    expectTypeOf<AudioUIProviderProps>().toMatchTypeOf<HostRuntimeBaseProps>();
    expectTypeOf<AIUIProviderProps>().toMatchTypeOf<HostRuntimeBaseProps>();
    expectTypeOf<VideoPlaylistProviderProps>().toMatchTypeOf<HostRuntimeBaseProps>();
    expectTypeOf<VfsExplorerProviderProps>().toMatchTypeOf<HostRuntimeBaseProps>();
    expectTypeOf<VehiclesRuntimeProviderProps>().toMatchTypeOf<HostRuntimeBaseProps>();
    expectTypeOf<HealthRuntimeProviderProps>().toMatchTypeOf<HostRuntimeBaseProps>();
    expectTypeOf<WalletRuntimeProviderProps>().toMatchTypeOf<HostRuntimeBaseProps>();
    expectTypeOf<BusinessesProviderProps>().toMatchTypeOf<HostRuntimeBaseProps>();
    expectTypeOf<EmailProviderProps>().toMatchTypeOf<HostRuntimeBaseProps>();
    expectTypeOf<CalendarUIProviderProps>().toMatchTypeOf<HostRuntimeBaseProps>();
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
