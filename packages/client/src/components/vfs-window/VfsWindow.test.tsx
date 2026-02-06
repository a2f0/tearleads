import type { VfsOpenItem } from '@rapid/vfs-explorer';
import { act, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VfsWindow } from './index';

const mockOpenWindow = vi.fn();
const mockRequestWindowOpen = vi.fn();

const mockResolveFileOpenTarget = vi.fn();
const mockResolvePlaylistType = vi.fn();
const mockUploadFile = vi.fn();
const mockDbSelect = vi.fn();
const mockDbInsert = vi.fn();

// Mock database context
const mockUseDatabaseContext = vi.fn();
vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockUseDatabaseContext()
}));

// Mock InlineUnlock component
vi.mock('@/components/sqlite/InlineUnlock', () => ({
  InlineUnlock: ({ description }: { description: string }) => (
    <div data-testid="inline-unlock">Unlock {description}</div>
  )
}));

// Mock FloatingWindow component
vi.mock('@/components/floating-window', () => ({
  FloatingWindow: ({ children }: { children: ReactNode }) => (
    <div data-testid="floating-window">{children}</div>
  )
}));

let latestProps: {
  onItemOpen?: (item: VfsOpenItem) => void;
  onUpload?: (folderId: string) => void;
} | null = null;

vi.mock('@rapid/vfs-explorer', () => ({
  VfsWindow: (props: {
    onItemOpen?: (item: VfsOpenItem) => void;
    onUpload?: (folderId: string) => void;
  }) => {
    latestProps = props;
    return <div data-testid="vfs-window-base" />;
  }
}));

vi.mock('@/contexts/ClientVfsExplorerProvider', () => ({
  ClientVfsExplorerProvider: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  )
}));

vi.mock('@/contexts/WindowManagerContext', () => ({
  useWindowManager: () => ({
    openWindow: mockOpenWindow,
    requestWindowOpen: mockRequestWindowOpen,
    windowOpenRequests: {},
    windows: [],
    closeWindow: vi.fn(),
    focusWindow: vi.fn(),
    minimizeWindow: vi.fn(),
    restoreWindow: vi.fn(),
    updateWindowDimensions: vi.fn(),
    saveWindowDimensionsForType: vi.fn(),
    isWindowOpen: vi.fn(),
    getWindow: vi.fn()
  })
}));

vi.mock('@/lib/vfs-open', () => ({
  resolveFileOpenTarget: (...args: unknown[]) =>
    mockResolveFileOpenTarget(...args),
  resolvePlaylistType: (...args: unknown[]) => mockResolvePlaylistType(...args)
}));

vi.mock('@/hooks/useFileUpload', () => ({
  useFileUpload: () => ({
    uploadFile: mockUploadFile
  })
}));

describe('VfsWindow', () => {
  beforeEach(() => {
    mockOpenWindow.mockReset();
    mockRequestWindowOpen.mockReset();
    mockResolveFileOpenTarget.mockReset();
    mockResolvePlaylistType.mockReset();
    mockUploadFile.mockReset();
    mockDbSelect.mockReset();
    mockDbInsert.mockReset();
    latestProps = null;

    // Create chainable mock for db.select().from().where()
    const mockWhere = vi.fn().mockResolvedValue([]);
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    mockDbSelect.mockReturnValue({ from: mockFrom });

    // Create chainable mock for db.insert().values()
    const mockValues = vi.fn().mockResolvedValue(undefined);
    mockDbInsert.mockReturnValue({ values: mockValues });

    mockUseDatabaseContext.mockReturnValue({
      db: {
        select: mockDbSelect,
        insert: mockDbInsert
      },
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

  it('triggers file input click when onUpload is called', () => {
    const { container } = render(
      <VfsWindow
        id="vfs-upload-1"
        onClose={vi.fn()}
        onMinimize={vi.fn()}
        onFocus={vi.fn()}
        zIndex={100}
      />
    );

    const fileInput = container.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    const clickSpy = vi.spyOn(fileInput, 'click');

    latestProps?.onUpload?.('folder-123');

    expect(clickSpy).toHaveBeenCalled();
  });

  it('uploads file and creates VFS link when file is selected', async () => {
    mockUploadFile.mockResolvedValue({ id: 'file-id-123', isDuplicate: false });

    const { container } = render(
      <VfsWindow
        id="vfs-upload-2"
        onClose={vi.fn()}
        onMinimize={vi.fn()}
        onFocus={vi.fn()}
        zIndex={100}
      />
    );

    // Trigger upload with folder ID
    latestProps?.onUpload?.('folder-456');

    // Simulate file selection
    const fileInput = container.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    const file = new File(['test'], 'test.txt', { type: 'text/plain' });

    Object.defineProperty(fileInput, 'files', {
      value: [file],
      writable: false
    });

    await act(async () => {
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(mockUploadFile).toHaveBeenCalledWith(file);
  });

  it('does not create duplicate VFS link if link already exists', async () => {
    mockUploadFile.mockResolvedValue({ id: 'file-id-789', isDuplicate: false });

    // Mock that link already exists
    const mockWhere = vi.fn().mockResolvedValue([{ id: 'existing-link' }]);
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    mockDbSelect.mockReturnValue({ from: mockFrom });

    const { container } = render(
      <VfsWindow
        id="vfs-upload-3"
        onClose={vi.fn()}
        onMinimize={vi.fn()}
        onFocus={vi.fn()}
        zIndex={100}
      />
    );

    // Trigger upload with folder ID
    latestProps?.onUpload?.('folder-789');

    // Simulate file selection
    const fileInput = container.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    const file = new File(['test'], 'test.txt', { type: 'text/plain' });

    Object.defineProperty(fileInput, 'files', {
      value: [file],
      writable: false
    });

    await act(async () => {
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(mockUploadFile).toHaveBeenCalled();
    // Insert should not be called since link exists
    expect(mockDbInsert).not.toHaveBeenCalled();
  });
});
