import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Outlet } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AppRoutes } from './AppRoutes';

function makePage(name: string) {
  return function MockPage() {
    return <div data-testid={name}>{name}</div>;
  };
}

vi.mock('./app/App', () => ({
  default: () => <Outlet />
}));

vi.mock('./components/auth', () => ({
  RequireAuth: ({ children }: { children: ReactNode }) => (
    <div data-testid="require-auth">{children}</div>
  )
}));

vi.mock('./lazyPages', () => ({
  Admin: makePage('admin'),
  AdminLauncher: makePage('admin-launcher'),
  AiRequestsAdminPage: makePage('ai-requests-admin-page'),
  Analytics: makePage('analytics'),
  ApiDocsPage: makePage('api-docs-page'),
  AudioDetail: makePage('audio-detail'),
  AudioPage: makePage('audio-page'),
  Backups: makePage('backups'),
  Businesses: makePage('businesses'),
  CacheStorage: makePage('cache-storage'),
  Calendar: makePage('calendar'),
  CameraPage: makePage('camera-page'),
  Chat: makePage('chat'),
  Classic: makePage('classic'),
  Compliance: makePage('compliance'),
  ComplianceDocPage: makePage('compliance-doc-page'),
  Console: makePage('console'),
  ContactDetail: makePage('contact-detail'),
  ContactNew: makePage('contact-new'),
  Contacts: makePage('contacts'),
  DebugBrowserLauncher: makePage('debug-browser-launcher'),
  DebugLauncher: makePage('debug-launcher'),
  DebugSystemInfo: makePage('debug-system-info'),
  DocumentDetail: makePage('document-detail'),
  Documents: makePage('documents'),
  Email: makePage('email'),
  Files: makePage('files'),
  GroupDetailPageRoute: makePage('group-detail-page-route'),
  GroupsAdminPage: makePage('groups-admin-page'),
  Health: makePage('health'),
  Help: makePage('help'),
  HelpDocPage: makePage('help-doc-page'),
  Home: makePage('home'),
  Keychain: makePage('keychain'),
  KeychainDetail: makePage('keychain-detail'),
  Licenses: makePage('licenses'),
  LocalStorage: makePage('local-storage'),
  MlsChat: makePage('mls-chat'),
  Models: makePage('models'),
  NoteDetail: makePage('note-detail'),
  Notes: makePage('notes'),
  Opfs: makePage('opfs'),
  OrganizationDetailPageRoute: makePage('organization-detail-page-route'),
  OrganizationsAdminPage: makePage('organizations-admin-page'),
  PhotoDetail: makePage('photo-detail'),
  Photos: makePage('photos'),
  PostgresAdmin: makePage('postgres-admin'),
  Search: makePage('search'),
  Settings: makePage('settings'),
  Sqlite: makePage('sqlite'),
  Sync: makePage('sync'),
  TableRows: makePage('table-rows'),
  Tables: makePage('tables'),
  UsersAdminDetail: makePage('users-admin-detail'),
  UsersAdminPage: makePage('users-admin-page'),
  Vehicles: makePage('vehicles'),
  Vfs: makePage('vfs'),
  VideoDetail: makePage('video-detail'),
  VideoPage: makePage('video-page'),
  Wallet: makePage('wallet'),
  WalletDetail: makePage('wallet-detail'),
  WalletNewItem: makePage('wallet-new-item')
}));

describe('AppRoutes', () => {
  it('renders the console route', () => {
    render(
      <MemoryRouter initialEntries={['/console']}>
        <AppRoutes />
      </MemoryRouter>
    );

    expect(screen.getByTestId('console')).toBeInTheDocument();
  });

  it('renders auth-protected AI route through RequireAuth', () => {
    render(
      <MemoryRouter initialEntries={['/ai']}>
        <AppRoutes />
      </MemoryRouter>
    );

    expect(screen.getByTestId('require-auth')).toBeInTheDocument();
    expect(screen.getByTestId('chat')).toBeInTheDocument();
  });
});
