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

describe('VfsWindow - File Resolution', () => {
  beforeEach(() => {
    resetAllMocks();
  });

  it('opens documents window for file items resolved as documents', async () => {
    mockResolveFileOpenTarget.mockResolvedValue('document');

    render(
      <VfsWindow
        id="vfs-2"
        onClose={vi.fn()}
        onMinimize={vi.fn()}
        onFocus={vi.fn()}
        zIndex={100}
      />
    );

    await latestProps?.onItemOpen?.({
      id: 'file-1',
      objectType: 'file',
      name: 'Doc',
      createdAt: new Date()
    });

    expect(mockOpenWindow).toHaveBeenCalledWith('documents');
    expect(mockRequestWindowOpen).toHaveBeenCalledWith('documents', {
      documentId: 'file-1'
    });
  });

  it('opens files window for file items resolved as generic files', async () => {
    mockResolveFileOpenTarget.mockResolvedValue('file');

    render(
      <VfsWindow
        id="vfs-6"
        onClose={vi.fn()}
        onMinimize={vi.fn()}
        onFocus={vi.fn()}
        zIndex={100}
      />
    );

    await latestProps?.onItemOpen?.({
      id: 'file-2',
      objectType: 'file',
      name: 'File',
      createdAt: new Date()
    });

    expect(mockOpenWindow).toHaveBeenCalledWith('files');
    expect(mockRequestWindowOpen).toHaveBeenCalledWith('files', {
      fileId: 'file-2'
    });
  });

  it('opens audio window for file items resolved as audio', async () => {
    mockResolveFileOpenTarget.mockResolvedValue('audio');

    render(
      <VfsWindow
        id="vfs-7"
        onClose={vi.fn()}
        onMinimize={vi.fn()}
        onFocus={vi.fn()}
        zIndex={100}
      />
    );

    await latestProps?.onItemOpen?.({
      id: 'file-3',
      objectType: 'file',
      name: 'Track',
      createdAt: new Date()
    });

    expect(mockOpenWindow).toHaveBeenCalledWith('audio');
    expect(mockRequestWindowOpen).toHaveBeenCalledWith('audio', {
      audioId: 'file-3'
    });
  });

  it('opens photos window for file items resolved as photos', async () => {
    mockResolveFileOpenTarget.mockResolvedValue('photo');

    render(
      <VfsWindow
        id="vfs-8"
        onClose={vi.fn()}
        onMinimize={vi.fn()}
        onFocus={vi.fn()}
        zIndex={100}
      />
    );

    await latestProps?.onItemOpen?.({
      id: 'file-4',
      objectType: 'file',
      name: 'Image',
      createdAt: new Date()
    });

    expect(mockOpenWindow).toHaveBeenCalledWith('photos');
    expect(mockRequestWindowOpen).toHaveBeenCalledWith('photos', {
      photoId: 'file-4'
    });
  });

  it('opens videos window for file items resolved as videos', async () => {
    mockResolveFileOpenTarget.mockResolvedValue('video');

    render(
      <VfsWindow
        id="vfs-9"
        onClose={vi.fn()}
        onMinimize={vi.fn()}
        onFocus={vi.fn()}
        zIndex={100}
      />
    );

    await latestProps?.onItemOpen?.({
      id: 'file-5',
      objectType: 'file',
      name: 'Movie',
      createdAt: new Date()
    });

    expect(mockOpenWindow).toHaveBeenCalledWith('videos');
    expect(mockRequestWindowOpen).toHaveBeenCalledWith('videos', {
      videoId: 'file-5'
    });
  });

  it('does nothing for unknown file open targets', async () => {
    mockResolveFileOpenTarget.mockResolvedValue('archive');

    render(
      <VfsWindow
        id="vfs-9b"
        onClose={vi.fn()}
        onMinimize={vi.fn()}
        onFocus={vi.fn()}
        zIndex={100}
      />
    );

    await latestProps?.onItemOpen?.({
      id: 'file-6',
      objectType: 'file',
      name: 'Archive',
      createdAt: new Date()
    });

    expect(mockOpenWindow).not.toHaveBeenCalled();
    expect(mockRequestWindowOpen).not.toHaveBeenCalled();
  });
});
