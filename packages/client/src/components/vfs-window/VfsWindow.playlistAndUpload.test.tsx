import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createClientVfsExplorerProviderMock,
  createDesktopFloatingWindowMock,
  createInlineUnlockMock,
  createVfsWindowMock,
  latestProps,
  mockFileInputRef,
  mockHandleFileInputChange,
  mockHandleUpload,
  mockOpenWindow,
  mockRequestWindowOpen,
  mockResolveFileOpenTarget,
  mockResolvePlaylistType,
  mockUseDatabaseContext,
  resetAllMocks
} from './VfsWindow.testSetup';
import { VfsWindow } from './index';

// Mock database context
vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockUseDatabaseContext()
}));

// Mock useVfsUploader hook
vi.mock('@/hooks/vfs', () => ({
  useVfsUploader: () => ({
    fileInputRef: mockFileInputRef,
    refreshToken: 0,
    handleUpload: mockHandleUpload,
    handleFileInputChange: mockHandleFileInputChange
  })
}));

// Mock InlineUnlock component
vi.mock('@/components/sqlite/InlineUnlock', () => ({
  InlineUnlock: createInlineUnlockMock()
}));

// Mock FloatingWindow component
vi.mock('@tearleads/window-manager', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@tearleads/window-manager')>();

  return {
    ...actual,
    DesktopFloatingWindow: createDesktopFloatingWindowMock()
  };
});

vi.mock('@tearleads/vfs-explorer', () => ({
  VfsWindow: createVfsWindowMock()
}));

vi.mock('@/contexts/ClientVfsExplorerProvider', () => ({
  ClientVfsExplorerProvider: createClientVfsExplorerProviderMock()
}));

vi.mock('@/contexts/WindowManagerContext', () => ({
  useWindowManagerActions: () => ({
    openWindow: mockOpenWindow,
    requestWindowOpen: mockRequestWindowOpen,
    closeWindow: vi.fn(),
    focusWindow: vi.fn(),
    minimizeWindow: vi.fn(),
    restoreWindow: vi.fn(),
    updateWindowDimensions: vi.fn(),
    saveWindowDimensionsForType: vi.fn()
  })
}));

vi.mock('@/lib/vfsOpen', () => ({
  resolveFileOpenTarget: (...args: unknown[]) =>
    mockResolveFileOpenTarget(...args),
  resolvePlaylistType: (...args: unknown[]) => mockResolvePlaylistType(...args)
}));

describe('VfsWindow - Playlist and Upload', () => {
  beforeEach(() => {
    resetAllMocks();
  });

  it('opens audio window for audio playlist items', async () => {
    mockResolvePlaylistType.mockResolvedValue('audio');

    render(
      <VfsWindow
        id="vfs-12"
        onClose={vi.fn()}
        onMinimize={vi.fn()}
        onFocus={vi.fn()}
        zIndex={100}
      />
    );

    await latestProps?.onItemOpen?.({
      id: 'playlist-1',
      objectType: 'playlist',
      name: 'Audio Playlist',
      createdAt: new Date()
    });

    expect(mockOpenWindow).toHaveBeenCalledWith('audio');
    expect(mockRequestWindowOpen).toHaveBeenCalledWith('audio', {
      playlistId: 'playlist-1'
    });
  });

  it('opens videos window for video playlist items', async () => {
    mockResolvePlaylistType.mockResolvedValue('video');

    render(
      <VfsWindow
        id="vfs-12b"
        onClose={vi.fn()}
        onMinimize={vi.fn()}
        onFocus={vi.fn()}
        zIndex={100}
      />
    );

    await latestProps?.onItemOpen?.({
      id: 'playlist-2',
      objectType: 'playlist',
      name: 'Video Playlist',
      createdAt: new Date()
    });

    expect(mockOpenWindow).toHaveBeenCalledWith('videos');
    expect(mockRequestWindowOpen).toHaveBeenCalledWith('videos', {
      playlistId: 'playlist-2'
    });
  });

  it('passes handleUpload to VfsWindowBase onUpload prop', () => {
    render(
      <VfsWindow
        id="vfs-upload-1"
        onClose={vi.fn()}
        onMinimize={vi.fn()}
        onFocus={vi.fn()}
        zIndex={100}
      />
    );

    // Call onUpload from VfsWindowBase props
    latestProps?.onUpload?.('folder-123');

    // Should call the mocked handleUpload from useVfsUploader
    expect(mockHandleUpload).toHaveBeenCalledWith('folder-123');
  });
});
