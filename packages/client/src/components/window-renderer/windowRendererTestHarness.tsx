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

vi.mock('@/components/notes-window', () => ({
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
vi.mock('@/components/email-window', () => ({
  EmailWindow: createMockWindowComponent({
    testIdPrefix: 'email-window',
    minimizeDimensions: { x: 0, y: 0, width: 550, height: 450 },
    includeInitialWidth: true
  })
}));
vi.mock('@/components/settings-window', () => ({
  SettingsWindow: createMockWindowComponent({ testIdPrefix: 'settings-window' })
}));
vi.mock('@/components/photos-window', () => ({
  PhotosWindow: createMockWindowComponent({
    testIdPrefix: 'photos-window',
    minimizeDimensions: { x: 0, y: 0, width: 700, height: 550 }
  })
}));
vi.mock('@/components/models-window', () => ({
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
vi.mock('@/components/sync-window', () => ({
  SyncWindow: createMockWindowComponent({
    testIdPrefix: 'sync-window',
    minimizeDimensions: { x: 0, y: 0, width: 400, height: 450 }
  })
}));
vi.mock('@/components/wallet-window', () => ({
  WalletWindow: createMockWindowComponent({
    testIdPrefix: 'wallet-window',
    minimizeDimensions: { x: 0, y: 0, width: 760, height: 560 }
  })
}));
vi.mock('@/components/files-window', () => ({
  FilesWindow: createMockWindowComponent({
    testIdPrefix: 'files-window',
    minimizeDimensions: { x: 0, y: 0, width: 500, height: 400 }
  })
}));
vi.mock('@/components/documents-window', () => ({
  DocumentsWindow: createMockWindowComponent({
    testIdPrefix: 'documents-window',
    minimizeDimensions: { x: 0, y: 0, width: 700, height: 550 }
  })
}));
vi.mock('@/components/help-window', () => ({
  HelpWindow: createMockWindowComponent({
    testIdPrefix: 'help-window',
    minimizeDimensions: { x: 0, y: 0, width: 900, height: 700 }
  })
}));
vi.mock('@/components/video-window', () => ({
  VideoWindow: createMockWindowComponent({
    testIdPrefix: 'video-window',
    minimizeDimensions: { x: 0, y: 0, width: 650, height: 500 }
  })
}));
vi.mock('@/components/contacts-window', () => ({
  ContactsWindow: createMockWindowComponent({
    testIdPrefix: 'contacts-window',
    minimizeDimensions: { x: 0, y: 0, width: 600, height: 500 }
  })
}));
vi.mock('@/components/local-storage-window', () => ({
  LocalStorageWindow: createMockWindowComponent({
    testIdPrefix: 'local-storage-window',
    minimizeDimensions: { x: 0, y: 0, width: 520, height: 420 }
  })
}));
vi.mock('@/components/sqlite-window', () => ({
  SqliteWindow: createMockWindowComponent({
    testIdPrefix: 'sqlite-window',
    minimizeDimensions: { x: 0, y: 0, width: 600, height: 500 }
  })
}));
vi.mock('@/components/opfs-window', () => ({
  OpfsWindow: createMockWindowComponent({
    testIdPrefix: 'opfs-window',
    minimizeDimensions: { x: 0, y: 0, width: 720, height: 560 }
  })
}));
vi.mock('@/components/cache-storage-window', () => ({
  CacheStorageWindow: createMockWindowComponent({
    testIdPrefix: 'cache-storage-window',
    minimizeDimensions: { x: 0, y: 0, width: 650, height: 500 }
  })
}));
vi.mock('@/components/calendar-window', () => ({
  CalendarWindow: createMockWindowComponent({
    testIdPrefix: 'calendar-window',
    minimizeDimensions: { x: 0, y: 0, width: 900, height: 640 }
  })
}));
vi.mock('@/components/businesses-window', () => ({
  BusinessesWindow: createMockWindowComponent({
    testIdPrefix: 'businesses-window',
    minimizeDimensions: { x: 0, y: 0, width: 860, height: 560 }
  })
}));
vi.mock('@/components/vehicles-window', () => ({
  VehiclesWindow: createMockWindowComponent({
    testIdPrefix: 'vehicles-window',
    minimizeDimensions: { x: 0, y: 0, width: 900, height: 620 }
  })
}));
vi.mock('@/components/health-window', () => ({
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
vi.mock('@/components/audio-window', () => ({
  AudioWindow: createMockWindowComponent({
    testIdPrefix: 'audio-window',
    minimizeDimensions: { x: 0, y: 0, width: 600, height: 500 }
  })
}));
vi.mock('@/components/camera-window', () => ({
  CameraWindow: createMockWindowComponent({
    testIdPrefix: 'camera-window',
    minimizeDimensions: { x: 0, y: 0, width: 840, height: 620 }
  })
}));
vi.mock('@/components/admin-users-window', () => ({
  AdminUsersWindow: createMockWindowComponent({
    testIdPrefix: 'admin-users-window',
    minimizeDimensions: { x: 0, y: 0, width: 840, height: 620 }
  })
}));
vi.mock('@/components/ai-window', () => ({
  AIWindow: createMockWindowComponent({
    testIdPrefix: 'ai-window',
    minimizeDimensions: { x: 0, y: 0, width: 700, height: 600 }
  })
}));
vi.mock('@/components/classic-window', () => ({
  ClassicWindow: createMockWindowComponent({
    testIdPrefix: 'classic-window',
    minimizeDimensions: { x: 0, y: 0, width: 980, height: 700 }
  })
}));
vi.mock('@/components/tables-window', () => ({
  TablesWindow: createMockWindowComponent({
    testIdPrefix: 'tables-window',
    minimizeDimensions: { x: 0, y: 0, width: 850, height: 600 }
  })
}));
vi.mock('@/components/debug-window', () => ({
  DebugWindow: createMockWindowComponent({
    testIdPrefix: 'debug-window',
    minimizeDimensions: { x: 0, y: 0, width: 600, height: 500 }
  })
}));

vi.mock('@/components/admin-window', () => ({
  AdminWindow: createMockWindowComponent({
    testIdPrefix: 'admin-window',
    minimizeDimensions: { x: 0, y: 0, width: 700, height: 600 }
  }),
  AdminRedisWindow: createMockWindowComponent({
    testIdPrefix: 'admin-redis-window',
    minimizeDimensions: { x: 0, y: 0, width: 700, height: 600 }
  }),
  AdminPostgresWindow: createMockWindowComponent({
    testIdPrefix: 'admin-postgres-window',
    minimizeDimensions: { x: 0, y: 0, width: 700, height: 600 }
  }),
  AdminGroupsWindow: createMockWindowComponent({
    testIdPrefix: 'admin-groups-window',
    minimizeDimensions: { x: 0, y: 0, width: 700, height: 600 }
  }),
  AdminOrganizationsWindow: createMockWindowComponent({
    testIdPrefix: 'admin-organizations-window',
    minimizeDimensions: { x: 0, y: 0, width: 840, height: 620 }
  })
}));

export const mockOpenWindow = vi.fn();
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
