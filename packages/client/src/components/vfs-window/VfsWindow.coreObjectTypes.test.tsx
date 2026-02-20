import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VfsWindow } from './index';
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

describe('VfsWindow - Core Object Types', () => {
  beforeEach(() => {
    resetAllMocks();
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

    await latestProps?.onItemOpen?.({
      id: 'contact-1',
      objectType: 'contact',
      name: 'Contact',
      createdAt: new Date()
    });

    expect(mockOpenWindow).toHaveBeenCalledWith('contacts');
    expect(mockRequestWindowOpen).toHaveBeenCalledWith('contacts', {
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

    await latestProps?.onItemOpen?.({
      id: 'note-1',
      objectType: 'note',
      name: 'Note',
      createdAt: new Date()
    });

    expect(mockOpenWindow).toHaveBeenCalledWith('notes');
    expect(mockRequestWindowOpen).toHaveBeenCalledWith('notes', {
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

    await latestProps?.onItemOpen?.({
      id: 'photo-1',
      objectType: 'photo',
      name: 'Photo',
      createdAt: new Date()
    });

    expect(mockOpenWindow).toHaveBeenCalledWith('photos');
    expect(mockRequestWindowOpen).toHaveBeenCalledWith('photos', {
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

    await latestProps?.onItemOpen?.({
      id: 'audio-1',
      objectType: 'audio',
      name: 'Track',
      createdAt: new Date()
    });

    expect(mockOpenWindow).toHaveBeenCalledWith('audio');
    expect(mockRequestWindowOpen).toHaveBeenCalledWith('audio', {
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

    await latestProps?.onItemOpen?.({
      id: 'album-1',
      objectType: 'album',
      name: 'Album',
      createdAt: new Date()
    });

    expect(mockOpenWindow).toHaveBeenCalledWith('photos');
    expect(mockRequestWindowOpen).toHaveBeenCalledWith('photos', {
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

    await latestProps?.onItemOpen?.({
      id: 'video-1',
      objectType: 'video',
      name: 'Video',
      createdAt: new Date()
    });

    expect(mockOpenWindow).toHaveBeenCalledWith('videos');
    expect(mockRequestWindowOpen).toHaveBeenCalledWith('videos', {
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

    await latestProps?.onItemOpen?.({
      id: 'email-1',
      objectType: 'email',
      name: 'Email',
      createdAt: new Date()
    });

    expect(mockOpenWindow).toHaveBeenCalledWith('email');
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

    await latestProps?.onItemOpen?.({
      id: 'group-1',
      objectType: 'contactGroup',
      name: 'Group',
      createdAt: new Date()
    });

    expect(mockOpenWindow).toHaveBeenCalledWith('contacts');
    expect(mockRequestWindowOpen).toHaveBeenCalledWith('contacts', {
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

    await latestProps?.onItemOpen?.({
      id: 'tag-1',
      objectType: 'tag',
      name: 'Tag',
      createdAt: new Date()
    });

    expect(mockOpenWindow).toHaveBeenCalledWith('files');
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

    await latestProps?.onItemOpen?.({
      id: 'folder-1',
      objectType: 'folder',
      name: 'Folder',
      createdAt: new Date()
    });

    expect(mockOpenWindow).not.toHaveBeenCalled();
    expect(mockRequestWindowOpen).not.toHaveBeenCalled();
  });
});
