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

describe('VfsWindow - File Resolution', () => {
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

  it('opens documents window for file items resolved as documents', async () => {
    hoistedMocks.mockResolveFileOpenTarget.mockResolvedValue('document');

    render(
      <VfsWindow
        id="vfs-2"
        onClose={vi.fn()}
        onMinimize={vi.fn()}
        onFocus={vi.fn()}
        zIndex={100}
      />
    );

    await hoistedMocks.getLatestProps()?.onItemOpen?.({
      id: 'file-1',
      objectType: 'file',
      name: 'Doc',
      createdAt: new Date()
    });

    expect(hoistedMocks.mockOpenWindow).toHaveBeenCalledWith('documents');
    expect(hoistedMocks.mockRequestWindowOpen).toHaveBeenCalledWith(
      'documents',
      {
        documentId: 'file-1'
      }
    );
  });

  it('opens files window for file items resolved as generic files', async () => {
    hoistedMocks.mockResolveFileOpenTarget.mockResolvedValue('file');

    render(
      <VfsWindow
        id="vfs-6"
        onClose={vi.fn()}
        onMinimize={vi.fn()}
        onFocus={vi.fn()}
        zIndex={100}
      />
    );

    await hoistedMocks.getLatestProps()?.onItemOpen?.({
      id: 'file-2',
      objectType: 'file',
      name: 'File',
      createdAt: new Date()
    });

    expect(hoistedMocks.mockOpenWindow).toHaveBeenCalledWith('files');
    expect(hoistedMocks.mockRequestWindowOpen).toHaveBeenCalledWith('files', {
      fileId: 'file-2'
    });
  });

  it('opens audio window for file items resolved as audio', async () => {
    hoistedMocks.mockResolveFileOpenTarget.mockResolvedValue('audio');

    render(
      <VfsWindow
        id="vfs-7"
        onClose={vi.fn()}
        onMinimize={vi.fn()}
        onFocus={vi.fn()}
        zIndex={100}
      />
    );

    await hoistedMocks.getLatestProps()?.onItemOpen?.({
      id: 'file-3',
      objectType: 'file',
      name: 'Track',
      createdAt: new Date()
    });

    expect(hoistedMocks.mockOpenWindow).toHaveBeenCalledWith('audio');
    expect(hoistedMocks.mockRequestWindowOpen).toHaveBeenCalledWith('audio', {
      audioId: 'file-3'
    });
  });

  it('opens photos window for file items resolved as photos', async () => {
    hoistedMocks.mockResolveFileOpenTarget.mockResolvedValue('photo');

    render(
      <VfsWindow
        id="vfs-8"
        onClose={vi.fn()}
        onMinimize={vi.fn()}
        onFocus={vi.fn()}
        zIndex={100}
      />
    );

    await hoistedMocks.getLatestProps()?.onItemOpen?.({
      id: 'file-4',
      objectType: 'file',
      name: 'Image',
      createdAt: new Date()
    });

    expect(hoistedMocks.mockOpenWindow).toHaveBeenCalledWith('photos');
    expect(hoistedMocks.mockRequestWindowOpen).toHaveBeenCalledWith('photos', {
      photoId: 'file-4'
    });
  });

  it('opens videos window for file items resolved as videos', async () => {
    hoistedMocks.mockResolveFileOpenTarget.mockResolvedValue('video');

    render(
      <VfsWindow
        id="vfs-9"
        onClose={vi.fn()}
        onMinimize={vi.fn()}
        onFocus={vi.fn()}
        zIndex={100}
      />
    );

    await hoistedMocks.getLatestProps()?.onItemOpen?.({
      id: 'file-5',
      objectType: 'file',
      name: 'Movie',
      createdAt: new Date()
    });

    expect(hoistedMocks.mockOpenWindow).toHaveBeenCalledWith('videos');
    expect(hoistedMocks.mockRequestWindowOpen).toHaveBeenCalledWith('videos', {
      videoId: 'file-5'
    });
  });

  it('does nothing for unknown file open targets', async () => {
    hoistedMocks.mockResolveFileOpenTarget.mockResolvedValue('archive');

    render(
      <VfsWindow
        id="vfs-9b"
        onClose={vi.fn()}
        onMinimize={vi.fn()}
        onFocus={vi.fn()}
        zIndex={100}
      />
    );

    await hoistedMocks.getLatestProps()?.onItemOpen?.({
      id: 'file-6',
      objectType: 'file',
      name: 'Archive',
      createdAt: new Date()
    });

    expect(hoistedMocks.mockOpenWindow).not.toHaveBeenCalled();
    expect(hoistedMocks.mockRequestWindowOpen).not.toHaveBeenCalled();
  });
});
