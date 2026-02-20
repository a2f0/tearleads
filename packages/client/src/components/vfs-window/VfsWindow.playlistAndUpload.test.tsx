import type { VfsOpenItem } from '@tearleads/vfs-explorer';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VfsWindow } from './index';

// Create hoisted mocks inline - cannot use imports in vi.mock() factories
const hoistedMocks = vi.hoisted(() => {
  let capturedProps: {
    onItemOpen?: (item: VfsOpenItem) => void;
    onUpload?: (folderId: string) => void;
  } | null = null;

  return {
    mockOpenWindow: vi.fn(),
    mockRequestWindowOpen: vi.fn(),
    mockResolveFileOpenTarget: vi.fn(),
    mockResolvePlaylistType: vi.fn(),
    mockHandleUpload: vi.fn(),
    mockHandleFileInputChange: vi.fn(),
    mockFileInputRef: { current: null },
    mockUseDatabaseContext: vi.fn(),
    getLatestProps: () => capturedProps,
    setLatestProps: (
      props: {
        onItemOpen?: (item: VfsOpenItem) => void;
        onUpload?: (folderId: string) => void;
      } | null
    ) => {
      capturedProps = props;
    }
  };
});

// Mock database context
vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => hoistedMocks.mockUseDatabaseContext()
}));

// Mock useVfsUploader hook
vi.mock('@/hooks/vfs', () => ({
  useVfsUploader: () => ({
    fileInputRef: hoistedMocks.mockFileInputRef,
    refreshToken: 0,
    handleUpload: hoistedMocks.mockHandleUpload,
    handleFileInputChange: hoistedMocks.mockHandleFileInputChange
  })
}));

// Mock InlineUnlock component
vi.mock('@/components/sqlite/InlineUnlock', () => ({
  InlineUnlock: ({ description }: { description: string }) => (
    <div data-testid="inline-unlock">Unlock {description}</div>
  )
}));

// Mock FloatingWindow component
vi.mock('@tearleads/window-manager', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@tearleads/window-manager')>();

  return {
    ...actual,
    DesktopFloatingWindow: ({ children }: { children: ReactNode }) => (
      <div data-testid="floating-window">{children}</div>
    )
  };
});

vi.mock('@tearleads/vfs-explorer', () => ({
  VfsWindow: (props: {
    onItemOpen?: (item: VfsOpenItem) => void;
    onUpload?: (folderId: string) => void;
  }) => {
    hoistedMocks.setLatestProps(props);
    return <div data-testid="vfs-window-base" />;
  }
}));

vi.mock('@/contexts/ClientVfsExplorerProvider', () => ({
  ClientVfsExplorerProvider: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  )
}));

vi.mock('@/contexts/WindowManagerContext', () => ({
  useWindowManagerActions: () => ({
    openWindow: hoistedMocks.mockOpenWindow,
    requestWindowOpen: hoistedMocks.mockRequestWindowOpen,
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
    hoistedMocks.mockResolveFileOpenTarget(...args),
  resolvePlaylistType: (...args: unknown[]) =>
    hoistedMocks.mockResolvePlaylistType(...args)
}));

describe('VfsWindow - Playlist and Upload', () => {
  beforeEach(() => {
    hoistedMocks.mockOpenWindow.mockReset();
    hoistedMocks.mockRequestWindowOpen.mockReset();
    hoistedMocks.mockResolveFileOpenTarget.mockReset();
    hoistedMocks.mockResolvePlaylistType.mockReset();
    hoistedMocks.mockHandleUpload.mockReset();
    hoistedMocks.mockHandleFileInputChange.mockReset();
    hoistedMocks.setLatestProps(null);
    hoistedMocks.mockUseDatabaseContext.mockReturnValue({
      isUnlocked: true,
      isLoading: false,
      currentInstanceId: 'test-instance'
    });
  });

  it('opens audio window for audio playlist items', async () => {
    hoistedMocks.mockResolvePlaylistType.mockResolvedValue('audio');

    render(
      <VfsWindow
        id="vfs-12"
        onClose={vi.fn()}
        onMinimize={vi.fn()}
        onFocus={vi.fn()}
        zIndex={100}
      />
    );

    await hoistedMocks.getLatestProps()?.onItemOpen?.({
      id: 'playlist-1',
      objectType: 'playlist',
      name: 'Audio Playlist',
      createdAt: new Date()
    });

    expect(hoistedMocks.mockOpenWindow).toHaveBeenCalledWith('audio');
    expect(hoistedMocks.mockRequestWindowOpen).toHaveBeenCalledWith('audio', {
      playlistId: 'playlist-1'
    });
  });

  it('opens videos window for video playlist items', async () => {
    hoistedMocks.mockResolvePlaylistType.mockResolvedValue('video');

    render(
      <VfsWindow
        id="vfs-12b"
        onClose={vi.fn()}
        onMinimize={vi.fn()}
        onFocus={vi.fn()}
        zIndex={100}
      />
    );

    await hoistedMocks.getLatestProps()?.onItemOpen?.({
      id: 'playlist-2',
      objectType: 'playlist',
      name: 'Video Playlist',
      createdAt: new Date()
    });

    expect(hoistedMocks.mockOpenWindow).toHaveBeenCalledWith('videos');
    expect(hoistedMocks.mockRequestWindowOpen).toHaveBeenCalledWith('videos', {
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
    hoistedMocks.getLatestProps()?.onUpload?.('folder-123');

    // Should call the mocked handleUpload from useVfsUploader
    expect(hoistedMocks.mockHandleUpload).toHaveBeenCalledWith('folder-123');
  });
});
