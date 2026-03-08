// one-component-per-file: allow -- test harness intentionally defines local JSX helpers/mocks in one file.
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { vi } from 'vitest';
import { WindowManagerProvider } from '@/contexts/WindowManagerContext';

export interface WindowDimensions {
  x: number;
  y: number;
  width: number;
  height: number;
  isMaximized?: boolean;
}

interface MockWindowProps {
  id: string;
  onClose: () => void;
  onMinimize?: (dimensions: WindowDimensions) => void;
  onFocus: () => void;
  onDimensionsChange?: (dimensions: WindowDimensions) => void;
  initialDimensions?: WindowDimensions;
  zIndex: number;
}

interface MockWindowConfig {
  testIdPrefix: string;
  minimizeDimensions?: WindowDimensions;
  includeInitialWidth?: boolean;
  includeResizeControls?: boolean;
}

function createMockWindowComponent(config: MockWindowConfig) {
  return function MockWindow(props: MockWindowProps) {
    const {
      id,
      onClose,
      onMinimize,
      onFocus,
      onDimensionsChange,
      initialDimensions,
      zIndex
    } = props;
    const minimizeDimensions = config.minimizeDimensions;

    return (
      <div
        role="dialog"
        data-testid={`${config.testIdPrefix}-${id}`}
        data-zindex={zIndex}
        data-initial-width={
          config.includeInitialWidth ? initialDimensions?.width : undefined
        }
        onClick={onFocus}
        onKeyDown={(event) => event.key === 'Enter' && onFocus()}
      >
        <button type="button" onClick={onClose} data-testid={`close-${id}`}>
          Close
        </button>
        {minimizeDimensions && onMinimize ? (
          <button
            type="button"
            onClick={() => onMinimize(minimizeDimensions)}
            data-testid={`minimize-${id}`}
          >
            Minimize
          </button>
        ) : null}
        {config.includeResizeControls ? (
          <>
            <button
              type="button"
              onClick={() =>
                onDimensionsChange?.({ x: 10, y: 20, width: 500, height: 400 })
              }
              data-testid={`resize-${id}`}
            >
              Resize
            </button>
            <button
              type="button"
              onClick={() =>
                onDimensionsChange?.({
                  x: 10,
                  y: 20,
                  width: 500,
                  height: 400,
                  isMaximized: true
                })
              }
              data-testid={`resize-maximized-${id}`}
            >
              ResizeMaximized
            </button>
          </>
        ) : null}
      </div>
    );
  };
}

vi.mock('@/components/window-notes', () => ({
  NotesWindow: createMockWindowComponent({
    testIdPrefix: 'notes-window',
    minimizeDimensions: { x: 0, y: 0, width: 400, height: 300 },
    includeInitialWidth: true,
    includeResizeControls: true
  })
}));
vi.mock('@tearleads/console', () => ({
  ConsoleWindow: createMockWindowComponent({
    testIdPrefix: 'console-window',
    minimizeDimensions: { x: 0, y: 0, width: 600, height: 400 },
    includeInitialWidth: true
  })
}));
vi.mock('@/components/window-email', () => ({
  EmailWindow: createMockWindowComponent({
    testIdPrefix: 'email-window',
    minimizeDimensions: { x: 0, y: 0, width: 550, height: 450 },
    includeInitialWidth: true
  })
}));
vi.mock('@/components/window-settings', () => ({
  SettingsWindow: createMockWindowComponent({ testIdPrefix: 'settings-window' })
}));
vi.mock('@/components/window-photos', () => ({
  PhotosWindow: createMockWindowComponent({
    testIdPrefix: 'photos-window',
    minimizeDimensions: { x: 0, y: 0, width: 700, height: 550 }
  })
}));
vi.mock('@/components/window-models', () => ({
  ModelsWindow: createMockWindowComponent({
    testIdPrefix: 'models-window',
    minimizeDimensions: { x: 0, y: 0, width: 720, height: 600 }
  })
}));
vi.mock('@tearleads/keychain', () => ({
  KeychainWindow: createMockWindowComponent({
    testIdPrefix: 'keychain-window',
    minimizeDimensions: { x: 0, y: 0, width: 600, height: 500 }
  })
}));
vi.mock('@/components/window-sync', () => ({
  SyncWindow: createMockWindowComponent({
    testIdPrefix: 'sync-window',
    minimizeDimensions: { x: 0, y: 0, width: 400, height: 450 }
  })
}));
vi.mock('@/components/window-wallet', () => ({
  WalletWindow: createMockWindowComponent({
    testIdPrefix: 'wallet-window',
    minimizeDimensions: { x: 0, y: 0, width: 760, height: 560 }
  })
}));
vi.mock('@/components/window-files', () => ({
  FilesWindow: createMockWindowComponent({
    testIdPrefix: 'files-window',
    minimizeDimensions: { x: 0, y: 0, width: 500, height: 400 }
  })
}));
vi.mock('@/components/window-documents', () => ({
  DocumentsWindow: createMockWindowComponent({
    testIdPrefix: 'documents-window',
    minimizeDimensions: { x: 0, y: 0, width: 700, height: 550 }
  })
}));
vi.mock('@/components/window-help', () => ({
  HelpWindow: createMockWindowComponent({
    testIdPrefix: 'help-window',
    minimizeDimensions: { x: 0, y: 0, width: 900, height: 700 }
  })
}));
vi.mock('@/components/window-video', () => ({
  VideoWindow: createMockWindowComponent({
    testIdPrefix: 'video-window',
    minimizeDimensions: { x: 0, y: 0, width: 650, height: 500 }
  })
}));
vi.mock('@/components/window-contacts', () => ({
  ContactsWindow: createMockWindowComponent({
    testIdPrefix: 'contacts-window',
    minimizeDimensions: { x: 0, y: 0, width: 600, height: 500 }
  })
}));
vi.mock('@/components/window-local-storage', () => ({
  LocalStorageWindow: createMockWindowComponent({
    testIdPrefix: 'local-storage-window',
    minimizeDimensions: { x: 0, y: 0, width: 520, height: 420 }
  })
}));
vi.mock('@/components/window-sqlite', () => ({
  SqliteWindow: createMockWindowComponent({
    testIdPrefix: 'sqlite-window',
    minimizeDimensions: { x: 0, y: 0, width: 600, height: 500 }
  })
}));
vi.mock('@/components/window-opfs', () => ({
  OpfsWindow: createMockWindowComponent({
    testIdPrefix: 'opfs-window',
    minimizeDimensions: { x: 0, y: 0, width: 720, height: 560 }
  })
}));
vi.mock('@/components/window-cache-storage', () => ({
  CacheStorageWindow: createMockWindowComponent({
    testIdPrefix: 'cache-storage-window',
    minimizeDimensions: { x: 0, y: 0, width: 650, height: 500 }
  })
}));
vi.mock('@/components/window-calendar', () => ({
  CalendarWindow: createMockWindowComponent({
    testIdPrefix: 'calendar-window',
    minimizeDimensions: { x: 0, y: 0, width: 900, height: 640 }
  })
}));
vi.mock('@/components/window-businesses', () => ({
  BusinessesWindow: createMockWindowComponent({
    testIdPrefix: 'businesses-window',
    minimizeDimensions: { x: 0, y: 0, width: 860, height: 560 }
  })
}));
vi.mock('@/components/window-vehicles', () => ({
  VehiclesWindow: createMockWindowComponent({
    testIdPrefix: 'vehicles-window',
    minimizeDimensions: { x: 0, y: 0, width: 900, height: 620 }
  })
}));
vi.mock('@/components/window-health', () => ({
  HealthWindow: createMockWindowComponent({
    testIdPrefix: 'health-window',
    minimizeDimensions: { x: 0, y: 0, width: 760, height: 560 }
  })
}));
vi.mock('@tearleads/analytics', () => ({
  AnalyticsWindow: createMockWindowComponent({
    testIdPrefix: 'analytics-window',
    minimizeDimensions: { x: 0, y: 0, width: 700, height: 550 }
  })
}));
vi.mock('@/components/window-audio', () => ({
  AudioWindow: createMockWindowComponent({
    testIdPrefix: 'audio-window',
    minimizeDimensions: { x: 0, y: 0, width: 600, height: 500 }
  })
}));
vi.mock('@/components/window-camera', () => ({
  CameraWindow: createMockWindowComponent({
    testIdPrefix: 'camera-window',
    minimizeDimensions: { x: 0, y: 0, width: 840, height: 620 }
  })
}));
vi.mock('@/components/window-admin-users', () => ({
  AdminUsersWindow: createMockWindowComponent({
    testIdPrefix: 'admin-users-window',
    minimizeDimensions: { x: 0, y: 0, width: 840, height: 620 }
  })
}));
vi.mock('@/components/window-ai', () => ({
  AIWindow: createMockWindowComponent({
    testIdPrefix: 'ai-window',
    minimizeDimensions: { x: 0, y: 0, width: 700, height: 600 }
  })
}));
vi.mock('@/components/window-classic', () => ({
  ClassicWindow: createMockWindowComponent({
    testIdPrefix: 'classic-window',
    minimizeDimensions: { x: 0, y: 0, width: 980, height: 700 }
  })
}));
vi.mock('@/components/window-tables', () => ({
  TablesWindow: createMockWindowComponent({
    testIdPrefix: 'tables-window',
    minimizeDimensions: { x: 0, y: 0, width: 850, height: 600 }
  })
}));
vi.mock('@/components/window-debug', () => ({
  DebugWindow: createMockWindowComponent({
    testIdPrefix: 'debug-window',
    minimizeDimensions: { x: 0, y: 0, width: 600, height: 500 }
  })
}));

vi.mock('@/components/admin-windows', () => ({
  AdminWindow: createMockWindowComponent({
    testIdPrefix: 'admin-window',
    minimizeDimensions: { x: 0, y: 0, width: 700, height: 600 }
  })
}));
vi.mock('@/components/window-admin-redis', () => ({
  AdminRedisWindow: createMockWindowComponent({
    testIdPrefix: 'admin-redis-window',
    minimizeDimensions: { x: 0, y: 0, width: 700, height: 600 }
  })
}));
vi.mock('@/components/window-admin-postgres', () => ({
  AdminPostgresWindow: createMockWindowComponent({
    testIdPrefix: 'admin-postgres-window',
    minimizeDimensions: { x: 0, y: 0, width: 700, height: 600 }
  })
}));
vi.mock('@/components/window-admin-groups', () => ({
  AdminGroupsWindow: createMockWindowComponent({
    testIdPrefix: 'admin-groups-window',
    minimizeDimensions: { x: 0, y: 0, width: 700, height: 600 }
  })
}));
vi.mock('@/components/window-admin-organizations', () => ({
  AdminOrganizationsWindow: createMockWindowComponent({
    testIdPrefix: 'admin-organizations-window',
    minimizeDimensions: { x: 0, y: 0, width: 840, height: 620 }
  })
}));

const mockOpenWindow = vi.fn();
export const mockCloseWindow = vi.fn();
export const mockFocusWindow = vi.fn();
export const mockMinimizeWindow = vi.fn();
export const mockSaveWindowDimensionsForType = vi.fn();
export const mockUpdateWindowDimensions = vi.fn();

export let mockWindows: Array<{
  id: string;
  type: string;
  zIndex: number;
  dimensions?: WindowDimensions;
  isMinimized?: boolean;
}> = [];

vi.mock('@/contexts/WindowManagerContext', async () => {
  const actual = await vi.importActual('@/contexts/WindowManagerContext');
  return {
    ...actual,
    useWindowManager: () => ({
      windows: mockWindows,
      openWindow: mockOpenWindow,
      requestWindowOpen: vi.fn(),
      windowOpenRequests: {},
      closeWindow: mockCloseWindow,
      focusWindow: mockFocusWindow,
      minimizeWindow: mockMinimizeWindow,
      restoreWindow: vi.fn(),
      saveWindowDimensionsForType: mockSaveWindowDimensionsForType,
      updateWindowDimensions: mockUpdateWindowDimensions,
      isWindowOpen: vi.fn(),
      getWindow: vi.fn()
    })
  };
});

import { WindowRenderer } from './WindowRenderer';

function wrapper({ children }: { children: ReactNode }) {
  return <WindowManagerProvider>{children}</WindowManagerProvider>;
}

export function renderWindowRenderer() {
  return render(<WindowRenderer />, { wrapper });
}

export function setMockWindows(
  windows: Array<{
    id: string;
    type: string;
    zIndex: number;
    dimensions?: WindowDimensions;
    isMinimized?: boolean;
  }>
) {
  mockWindows = windows;
}

export function resetWindowRendererMocks() {
  vi.clearAllMocks();
  mockWindows = [];
}
