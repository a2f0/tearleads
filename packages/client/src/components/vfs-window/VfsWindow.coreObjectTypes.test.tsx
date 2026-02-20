import type { VfsOpenItem } from '@tearleads/vfs-explorer';
import type { ReactNode } from 'react';
import { render } from '@testing-library/react';
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

describe('VfsWindow - Core Object Types', () => {
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

  it('opens contacts window for contact items', async () => {
    render(
      <VfsWindow
        id="vfs-1"
        onClose={vi.fn()}
        onMinimize={vi.fn()}
        onFocus={vi.fn()}
        zIndex={100}
      />
    );

    await hoistedMocks.getLatestProps()?.onItemOpen?.({
      id: 'contact-1',
      objectType: 'contact',
      name: 'Contact',
      createdAt: new Date()
    });

    expect(hoistedMocks.mockOpenWindow).toHaveBeenCalledWith('contacts');
    expect(hoistedMocks.mockRequestWindowOpen).toHaveBeenCalledWith('contacts', {
      contactId: 'contact-1'
    });
  });

  it('opens notes window for note items', async () => {
    render(
      <VfsWindow
        id="vfs-3b"
        onClose={vi.fn()}
        onMinimize={vi.fn()}
        onFocus={vi.fn()}
        zIndex={100}
      />
    );

    await hoistedMocks.getLatestProps()?.onItemOpen?.({
      id: 'note-1',
      objectType: 'note',
      name: 'Note',
      createdAt: new Date()
    });

    expect(hoistedMocks.mockOpenWindow).toHaveBeenCalledWith('notes');
    expect(hoistedMocks.mockRequestWindowOpen).toHaveBeenCalledWith('notes', {
      noteId: 'note-1'
    });
  });

  it('opens photos window for photo items', async () => {
    render(
      <VfsWindow
        id="vfs-3"
        onClose={vi.fn()}
        onMinimize={vi.fn()}
        onFocus={vi.fn()}
        zIndex={100}
      />
    );

    await hoistedMocks.getLatestProps()?.onItemOpen?.({
      id: 'photo-1',
      objectType: 'photo',
      name: 'Photo',
      createdAt: new Date()
    });

    expect(hoistedMocks.mockOpenWindow).toHaveBeenCalledWith('photos');
    expect(hoistedMocks.mockRequestWindowOpen).toHaveBeenCalledWith('photos', {
      photoId: 'photo-1'
    });
  });

  it('opens audio window for audio items', async () => {
    render(
      <VfsWindow
        id="vfs-4"
        onClose={vi.fn()}
        onMinimize={vi.fn()}
        onFocus={vi.fn()}
        zIndex={100}
      />
    );

    await hoistedMocks.getLatestProps()?.onItemOpen?.({
      id: 'audio-1',
      objectType: 'audio',
      name: 'Track',
      createdAt: new Date()
    });

    expect(hoistedMocks.mockOpenWindow).toHaveBeenCalledWith('audio');
    expect(hoistedMocks.mockRequestWindowOpen).toHaveBeenCalledWith('audio', {
      audioId: 'audio-1'
    });
  });

  it('opens photos window for album items', async () => {
    render(
      <VfsWindow
        id="vfs-5"
        onClose={vi.fn()}
        onMinimize={vi.fn()}
        onFocus={vi.fn()}
        zIndex={100}
      />
    );

    await hoistedMocks.getLatestProps()?.onItemOpen?.({
      id: 'album-1',
      objectType: 'album',
      name: 'Album',
      createdAt: new Date()
    });

    expect(hoistedMocks.mockOpenWindow).toHaveBeenCalledWith('photos');
    expect(hoistedMocks.mockRequestWindowOpen).toHaveBeenCalledWith('photos', {
      albumId: 'album-1'
    });
  });

  it('opens videos window for video items', async () => {
    render(
      <VfsWindow
        id="vfs-5b"
        onClose={vi.fn()}
        onMinimize={vi.fn()}
        onFocus={vi.fn()}
        zIndex={100}
      />
    );

    await hoistedMocks.getLatestProps()?.onItemOpen?.({
      id: 'video-1',
      objectType: 'video',
      name: 'Video',
      createdAt: new Date()
    });

    expect(hoistedMocks.mockOpenWindow).toHaveBeenCalledWith('videos');
    expect(hoistedMocks.mockRequestWindowOpen).toHaveBeenCalledWith('videos', {
      videoId: 'video-1'
    });
  });

  it('opens email window for email items', async () => {
    render(
      <VfsWindow
        id="vfs-10"
        onClose={vi.fn()}
        onMinimize={vi.fn()}
        onFocus={vi.fn()}
        zIndex={100}
      />
    );

    await hoistedMocks.getLatestProps()?.onItemOpen?.({
      id: 'email-1',
      objectType: 'email',
      name: 'Email',
      createdAt: new Date()
    });

    expect(hoistedMocks.mockOpenWindow).toHaveBeenCalledWith('email');
  });

  it('opens contacts window for contact group items', async () => {
    render(
      <VfsWindow
        id="vfs-11"
        onClose={vi.fn()}
        onMinimize={vi.fn()}
        onFocus={vi.fn()}
        zIndex={100}
      />
    );

    await hoistedMocks.getLatestProps()?.onItemOpen?.({
      id: 'group-1',
      objectType: 'contactGroup',
      name: 'Group',
      createdAt: new Date()
    });

    expect(hoistedMocks.mockOpenWindow).toHaveBeenCalledWith('contacts');
    expect(hoistedMocks.mockRequestWindowOpen).toHaveBeenCalledWith('contacts', {
      groupId: 'group-1'
    });
  });

  it('opens files window for tag items', async () => {
    render(
      <VfsWindow
        id="vfs-13"
        onClose={vi.fn()}
        onMinimize={vi.fn()}
        onFocus={vi.fn()}
        zIndex={100}
      />
    );

    await hoistedMocks.getLatestProps()?.onItemOpen?.({
      id: 'tag-1',
      objectType: 'tag',
      name: 'Tag',
      createdAt: new Date()
    });

    expect(hoistedMocks.mockOpenWindow).toHaveBeenCalledWith('files');
  });

  it('does not open a window for folder items', async () => {
    render(
      <VfsWindow
        id="vfs-14"
        onClose={vi.fn()}
        onMinimize={vi.fn()}
        onFocus={vi.fn()}
        zIndex={100}
      />
    );

    await hoistedMocks.getLatestProps()?.onItemOpen?.({
      id: 'folder-1',
      objectType: 'folder',
      name: 'Folder',
      createdAt: new Date()
    });

    expect(hoistedMocks.mockOpenWindow).not.toHaveBeenCalled();
    expect(hoistedMocks.mockRequestWindowOpen).not.toHaveBeenCalled();
  });
});
