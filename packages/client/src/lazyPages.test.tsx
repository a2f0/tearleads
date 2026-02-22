import { cleanup, render, screen } from '@testing-library/react';
import { type ComponentType, Suspense } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

function page(name: string) {
  return function MockPage() {
    return <div data-testid={name}>{name}</div>;
  };
}

vi.mock('./pages/admin', () => ({
  Admin: page('Admin'),
  AdminLauncher: page('AdminLauncher'),
  AiRequestsAdminPage: page('AiRequestsAdminPage'),
  PostgresAdmin: page('PostgresAdmin'),
  GroupsAdminPage: page('GroupsAdminPage'),
  GroupDetailPageRoute: page('GroupDetailPageRoute'),
  OrganizationsAdminPage: page('OrganizationsAdminPage'),
  OrganizationDetailPageRoute: page('OrganizationDetailPageRoute'),
  UsersAdminPage: page('UsersAdminPage'),
  UsersAdminDetail: page('UsersAdminDetail')
}));
vi.mock('./pages/keychain', () => ({
  Keychain: page('Keychain'),
  KeychainDetail: page('KeychainDetail')
}));
vi.mock('./pages/wallet', () => ({
  Wallet: page('Wallet'),
  WalletDetail: page('WalletDetail'),
  WalletNewItem: page('WalletNewItem')
}));
vi.mock('./pages/sync', () => ({
  Sync: page('Sync')
}));

vi.mock('./pages/analytics', () => ({ Analytics: page('Analytics') }));
vi.mock('./pages/AudioDetail', () => ({ AudioDetail: page('AudioDetail') }));
vi.mock('./pages/Audio', () => ({ Audio: page('AudioPage') }));
vi.mock('./pages/Backups', () => ({ Backups: page('Backups') }));
vi.mock('./pages/Classic', () => ({ Classic: page('Classic') }));
vi.mock('./pages/cache-storage', () => ({
  CacheStorage: page('CacheStorage')
}));
vi.mock('./pages/Calendar', () => ({ Calendar: page('Calendar') }));
vi.mock('./pages/Camera', () => ({ Camera: page('CameraPage') }));
vi.mock('./pages/Businesses', () => ({ Businesses: page('Businesses') }));
vi.mock('./pages/Vehicles', () => ({ Vehicles: page('Vehicles') }));
vi.mock('./pages/chat', () => ({ Chat: page('Chat') }));
vi.mock('./pages/ContactDetail', () => ({
  ContactDetail: page('ContactDetail')
}));
vi.mock('./pages/console', () => ({ Console: page('Console') }));
vi.mock('./pages/ContactNew', () => ({ ContactNew: page('ContactNew') }));
vi.mock('./pages/contacts', () => ({ Contacts: page('Contacts') }));
vi.mock('./pages/debug', () => ({
  DebugBrowserLauncher: page('DebugBrowserLauncher'),
  DebugLauncher: page('DebugLauncher'),
  Debug: page('DebugSystemInfo')
}));
vi.mock('./pages/help/ApiDocs', () => ({ ApiDocsPage: page('ApiDocsPage') }));
vi.mock('./pages/help/HelpDoc', () => ({ HelpDocPage: page('HelpDocPage') }));
vi.mock('./pages/help/Help', () => ({ Help: page('Help') }));
vi.mock('./pages/compliance/Compliance', () => ({
  Compliance: page('Compliance')
}));
vi.mock('./pages/compliance/ComplianceDoc', () => ({
  ComplianceDocPage: page('ComplianceDocPage')
}));
vi.mock('./pages/DocumentDetail', () => ({
  DocumentDetail: page('DocumentDetail')
}));
vi.mock('./pages/Documents', () => ({ Documents: page('Documents') }));
vi.mock('./pages/Email', () => ({ Email: page('Email') }));
vi.mock('./pages/MlsChat', () => ({ MlsChat: page('MlsChat') }));
vi.mock('./pages/Files', () => ({ Files: page('Files') }));
vi.mock('./pages/Home', () => ({ Home: page('Home') }));
vi.mock('./pages/Health', () => ({ Health: page('Health') }));
vi.mock('./pages/Licenses', () => ({ Licenses: page('Licenses') }));
vi.mock('./pages/local-storage', () => ({
  LocalStorage: page('LocalStorage')
}));
vi.mock('./pages/models', () => ({ Models: page('Models') }));
vi.mock('./pages/NoteDetail', () => ({ NoteDetail: page('NoteDetail') }));
vi.mock('./pages/Notes', () => ({ Notes: page('Notes') }));
vi.mock('./pages/opfs', () => ({ Opfs: page('Opfs') }));
vi.mock('./pages/PhotoDetail', () => ({ PhotoDetail: page('PhotoDetail') }));
vi.mock('./pages/photos-components', () => ({ PhotosPage: page('Photos') }));
vi.mock('./pages/search', () => ({ Search: page('Search') }));
vi.mock('./pages/Settings', () => ({ Settings: page('Settings') }));
vi.mock('./pages/Sqlite', () => ({ Sqlite: page('Sqlite') }));
vi.mock('./pages/TableRows', () => ({ TableRows: page('TableRows') }));
vi.mock('./pages/Tables', () => ({ Tables: page('Tables') }));
vi.mock('./pages/VideoDetail', () => ({ VideoDetail: page('VideoDetail') }));
vi.mock('./pages/Vfs', () => ({ Vfs: page('Vfs') }));
vi.mock('./pages/Video', () => ({ Video: page('VideoPage') }));

import * as lazyPages from './lazyPages';

afterEach(() => {
  cleanup();
});

describe('lazyPages', () => {
  it('loads every lazy page component', async () => {
    const pageEntries: Array<[string, ComponentType]> = [
      ['Admin', lazyPages.Admin],
      ['AdminLauncher', lazyPages.AdminLauncher],
      ['AiRequestsAdminPage', lazyPages.AiRequestsAdminPage],
      ['PostgresAdmin', lazyPages.PostgresAdmin],
      ['GroupsAdminPage', lazyPages.GroupsAdminPage],
      ['GroupDetailPageRoute', lazyPages.GroupDetailPageRoute],
      ['OrganizationsAdminPage', lazyPages.OrganizationsAdminPage],
      ['OrganizationDetailPageRoute', lazyPages.OrganizationDetailPageRoute],
      ['UsersAdminPage', lazyPages.UsersAdminPage],
      ['UsersAdminDetail', lazyPages.UsersAdminDetail],
      ['Analytics', lazyPages.Analytics],
      ['AudioDetail', lazyPages.AudioDetail],
      ['AudioPage', lazyPages.AudioPage],
      ['Backups', lazyPages.Backups],
      ['Classic', lazyPages.Classic],
      ['CacheStorage', lazyPages.CacheStorage],
      ['Calendar', lazyPages.Calendar],
      ['CameraPage', lazyPages.CameraPage],
      ['Businesses', lazyPages.Businesses],
      ['Vehicles', lazyPages.Vehicles],
      ['Chat', lazyPages.Chat],
      ['ContactDetail', lazyPages.ContactDetail],
      ['Console', lazyPages.Console],
      ['ContactNew', lazyPages.ContactNew],
      ['Contacts', lazyPages.Contacts],
      ['DebugBrowserLauncher', lazyPages.DebugBrowserLauncher],
      ['DebugLauncher', lazyPages.DebugLauncher],
      ['DebugSystemInfo', lazyPages.DebugSystemInfo],
      ['ApiDocsPage', lazyPages.ApiDocsPage],
      ['HelpDocPage', lazyPages.HelpDocPage],
      ['Help', lazyPages.Help],
      ['Compliance', lazyPages.Compliance],
      ['ComplianceDocPage', lazyPages.ComplianceDocPage],
      ['DocumentDetail', lazyPages.DocumentDetail],
      ['Documents', lazyPages.Documents],
      ['Email', lazyPages.Email],
      ['MlsChat', lazyPages.MlsChat],
      ['Files', lazyPages.Files],
      ['Home', lazyPages.Home],
      ['Health', lazyPages.Health],
      ['Keychain', lazyPages.Keychain],
      ['KeychainDetail', lazyPages.KeychainDetail],
      ['Wallet', lazyPages.Wallet],
      ['WalletDetail', lazyPages.WalletDetail],
      ['WalletNewItem', lazyPages.WalletNewItem],
      ['Licenses', lazyPages.Licenses],
      ['LocalStorage', lazyPages.LocalStorage],
      ['Models', lazyPages.Models],
      ['NoteDetail', lazyPages.NoteDetail],
      ['Notes', lazyPages.Notes],
      ['Opfs', lazyPages.Opfs],
      ['PhotoDetail', lazyPages.PhotoDetail],
      ['Photos', lazyPages.Photos],
      ['Search', lazyPages.Search],
      ['Settings', lazyPages.Settings],
      ['Sync', lazyPages.Sync],
      ['Sqlite', lazyPages.Sqlite],
      ['TableRows', lazyPages.TableRows],
      ['Tables', lazyPages.Tables],
      ['VideoDetail', lazyPages.VideoDetail],
      ['Vfs', lazyPages.Vfs],
      ['VideoPage', lazyPages.VideoPage]
    ];

    for (const [name, PageComponent] of pageEntries) {
      render(
        <Suspense fallback={<div data-testid="loading" />}>
          <PageComponent />
        </Suspense>
      );
      expect(
        await screen.findByTestId(name, {}, { timeout: 5000 })
      ).toBeInTheDocument();
      cleanup();
    }
  }, 60_000);
});
