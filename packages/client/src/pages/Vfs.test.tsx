import type { VfsOpenItem } from '@rapid/vfs-explorer';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Vfs } from './Vfs';

vi.mock('@/components/ui/back-link', () => ({
  BackLink: ({
    defaultTo,
    defaultLabel
  }: {
    defaultTo: string;
    defaultLabel: string;
  }) => <a href={defaultTo}>{defaultLabel}</a>
}));

const mockNavigateWithFrom = vi.fn();
const mockResolveFileOpenTarget = vi.fn();
let latestVfsExplorerProps: {
  onItemOpen?: (item: VfsOpenItem) => void;
} | null = null;

vi.mock('@rapid/vfs-explorer', () => ({
  VfsExplorer: ({
    className,
    onItemOpen
  }: {
    className: string;
    onItemOpen?: (item: VfsOpenItem) => void;
  }) => {
    const capturedProps: { onItemOpen?: (item: VfsOpenItem) => void } = {};
    if (onItemOpen) {
      capturedProps.onItemOpen = onItemOpen;
    }
    latestVfsExplorerProps = capturedProps;
    return (
      <div data-testid="vfs-explorer" className={className}>
        VFS Explorer Component
      </div>
    );
  }
}));

vi.mock('@/contexts/ClientVfsExplorerProvider', () => ({
  ClientVfsExplorerProvider: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  )
}));

vi.mock('@/lib/navigation', () => ({
  useNavigateWithFrom: () => mockNavigateWithFrom
}));

vi.mock('@/lib/vfs-open', () => ({
  resolveFileOpenTarget: (...args: unknown[]) =>
    mockResolveFileOpenTarget(...args)
}));

describe('Vfs', () => {
  beforeEach(() => {
    mockNavigateWithFrom.mockReset();
    mockResolveFileOpenTarget.mockReset();
    latestVfsExplorerProps = null;
  });

  it('renders page title', () => {
    render(
      <MemoryRouter>
        <Vfs />
      </MemoryRouter>
    );

    expect(screen.getByText('VFS Explorer')).toBeInTheDocument();
  });

  it('renders description text', () => {
    render(
      <MemoryRouter>
        <Vfs />
      </MemoryRouter>
    );

    expect(
      screen.getByText(
        'Organize and share your data with end-to-end encryption'
      )
    ).toBeInTheDocument();
  });

  it('renders back link', () => {
    render(
      <MemoryRouter>
        <Vfs />
      </MemoryRouter>
    );

    expect(screen.getByText('Back to Home')).toBeInTheDocument();
  });

  it('renders VfsExplorer component', () => {
    render(
      <MemoryRouter>
        <Vfs />
      </MemoryRouter>
    );

    expect(screen.getByTestId('vfs-explorer')).toBeInTheDocument();
  });

  it('navigates to contact detail when opening a contact item', async () => {
    render(
      <MemoryRouter>
        <Vfs />
      </MemoryRouter>
    );

    await latestVfsExplorerProps?.onItemOpen?.({
      id: 'contact-1',
      objectType: 'contact',
      name: 'Contact',
      createdAt: new Date()
    });

    expect(mockNavigateWithFrom).toHaveBeenCalledWith('/contacts/contact-1', {
      fromLabel: 'Back to VFS Explorer'
    });
  });

  it('navigates to album view when opening an album item', async () => {
    render(
      <MemoryRouter>
        <Vfs />
      </MemoryRouter>
    );

    await latestVfsExplorerProps?.onItemOpen?.({
      id: 'album-1',
      objectType: 'album',
      name: 'Album',
      createdAt: new Date()
    });

    expect(mockNavigateWithFrom).toHaveBeenCalledWith('/photos?album=album-1', {
      fromLabel: 'Back to VFS Explorer'
    });
  });

  it('navigates to photo detail when opening a photo item', async () => {
    render(
      <MemoryRouter>
        <Vfs />
      </MemoryRouter>
    );

    await latestVfsExplorerProps?.onItemOpen?.({
      id: 'photo-1',
      objectType: 'photo',
      name: 'Photo',
      createdAt: new Date()
    });

    expect(mockNavigateWithFrom).toHaveBeenCalledWith('/photos/photo-1', {
      fromLabel: 'Back to VFS Explorer'
    });
  });

  it('navigates based on file type resolution', async () => {
    mockResolveFileOpenTarget.mockResolvedValue('video');
    render(
      <MemoryRouter>
        <Vfs />
      </MemoryRouter>
    );

    await latestVfsExplorerProps?.onItemOpen?.({
      id: 'file-1',
      objectType: 'file',
      name: 'Video',
      createdAt: new Date()
    });

    expect(mockNavigateWithFrom).toHaveBeenCalledWith('/videos/file-1', {
      fromLabel: 'Back to VFS Explorer'
    });
  });

  it('navigates to note detail when opening a note item', async () => {
    render(
      <MemoryRouter>
        <Vfs />
      </MemoryRouter>
    );

    await latestVfsExplorerProps?.onItemOpen?.({
      id: 'note-1',
      objectType: 'note',
      name: 'Note',
      createdAt: new Date()
    });

    expect(mockNavigateWithFrom).toHaveBeenCalledWith('/notes/note-1', {
      fromLabel: 'Back to VFS Explorer'
    });
  });

  it('navigates to email when opening an email item', async () => {
    render(
      <MemoryRouter>
        <Vfs />
      </MemoryRouter>
    );

    await latestVfsExplorerProps?.onItemOpen?.({
      id: 'email-1',
      objectType: 'email',
      name: 'Email',
      createdAt: new Date()
    });

    expect(mockNavigateWithFrom).toHaveBeenCalledWith('/email', {
      fromLabel: 'Back to VFS Explorer'
    });
  });

  it('navigates to documents when file resolves to document', async () => {
    mockResolveFileOpenTarget.mockResolvedValue('document');
    render(
      <MemoryRouter>
        <Vfs />
      </MemoryRouter>
    );

    await latestVfsExplorerProps?.onItemOpen?.({
      id: 'file-2',
      objectType: 'file',
      name: 'Doc',
      createdAt: new Date()
    });

    expect(mockNavigateWithFrom).toHaveBeenCalledWith('/documents/file-2', {
      fromLabel: 'Back to VFS Explorer'
    });
  });

  it('navigates to audio detail when opening an audio item', async () => {
    render(
      <MemoryRouter>
        <Vfs />
      </MemoryRouter>
    );

    await latestVfsExplorerProps?.onItemOpen?.({
      id: 'audio-1',
      objectType: 'audio',
      name: 'Track',
      createdAt: new Date()
    });

    expect(mockNavigateWithFrom).toHaveBeenCalledWith('/audio/audio-1', {
      fromLabel: 'Back to VFS Explorer'
    });
  });

  it('navigates to video detail when opening a video item', async () => {
    render(
      <MemoryRouter>
        <Vfs />
      </MemoryRouter>
    );

    await latestVfsExplorerProps?.onItemOpen?.({
      id: 'video-1',
      objectType: 'video',
      name: 'Clip',
      createdAt: new Date()
    });

    expect(mockNavigateWithFrom).toHaveBeenCalledWith('/videos/video-1', {
      fromLabel: 'Back to VFS Explorer'
    });
  });

  it('navigates to contacts list for contact groups', async () => {
    render(
      <MemoryRouter>
        <Vfs />
      </MemoryRouter>
    );

    await latestVfsExplorerProps?.onItemOpen?.({
      id: 'group-1',
      objectType: 'contactGroup',
      name: 'Group',
      createdAt: new Date()
    });

    expect(mockNavigateWithFrom).toHaveBeenCalledWith('/contacts', {
      fromLabel: 'Back to VFS Explorer'
    });
  });

  it('navigates to audio list for playlists', async () => {
    render(
      <MemoryRouter>
        <Vfs />
      </MemoryRouter>
    );

    await latestVfsExplorerProps?.onItemOpen?.({
      id: 'playlist-1',
      objectType: 'playlist',
      name: 'Playlist',
      createdAt: new Date()
    });

    expect(mockNavigateWithFrom).toHaveBeenCalledWith('/audio', {
      fromLabel: 'Back to VFS Explorer'
    });
  });

  it('navigates to files list for tags', async () => {
    render(
      <MemoryRouter>
        <Vfs />
      </MemoryRouter>
    );

    await latestVfsExplorerProps?.onItemOpen?.({
      id: 'tag-1',
      objectType: 'tag',
      name: 'Tag',
      createdAt: new Date()
    });

    expect(mockNavigateWithFrom).toHaveBeenCalledWith('/files', {
      fromLabel: 'Back to VFS Explorer'
    });
  });

  it('navigates to file detail when file open target is file', async () => {
    mockResolveFileOpenTarget.mockResolvedValue('file');
    render(
      <MemoryRouter>
        <Vfs />
      </MemoryRouter>
    );

    await latestVfsExplorerProps?.onItemOpen?.({
      id: 'file-5',
      objectType: 'file',
      name: 'Archive',
      createdAt: new Date()
    });

    expect(mockNavigateWithFrom).toHaveBeenCalledWith('/files/file-5', {
      fromLabel: 'Back to VFS Explorer'
    });
  });

  it('navigates based on file resolution for audio and photos', async () => {
    render(
      <MemoryRouter>
        <Vfs />
      </MemoryRouter>
    );

    mockResolveFileOpenTarget.mockResolvedValueOnce('audio');
    await latestVfsExplorerProps?.onItemOpen?.({
      id: 'file-3',
      objectType: 'file',
      name: 'Track',
      createdAt: new Date()
    });

    mockResolveFileOpenTarget.mockResolvedValueOnce('photo');
    await latestVfsExplorerProps?.onItemOpen?.({
      id: 'file-4',
      objectType: 'file',
      name: 'Photo',
      createdAt: new Date()
    });

    expect(mockNavigateWithFrom).toHaveBeenCalledWith('/audio/file-3', {
      fromLabel: 'Back to VFS Explorer'
    });
    expect(mockNavigateWithFrom).toHaveBeenCalledWith('/photos/file-4', {
      fromLabel: 'Back to VFS Explorer'
    });
  });

  it('does nothing when attempting to open folders', async () => {
    render(
      <MemoryRouter>
        <Vfs />
      </MemoryRouter>
    );

    await latestVfsExplorerProps?.onItemOpen?.({
      id: 'folder-1',
      objectType: 'folder',
      name: 'Folder',
      createdAt: new Date()
    });

    expect(mockNavigateWithFrom).not.toHaveBeenCalled();
  });
});
