import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockConsoleError } from '@/test/console-mocks';

const mockUseDatabaseContext = vi.fn();
const mockLoadClassicStateFromDatabase = vi.fn();
const mockPersistClassicOrderToDatabase = vi.fn();
const mockCreateClassicTag = vi.fn();
const mockCreateClassicNote = vi.fn();

vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockUseDatabaseContext()
}));

vi.mock('@/components/sqlite/InlineUnlock', () => ({
  InlineUnlock: ({ description }: { description: string }) => (
    <div data-testid="inline-unlock">{description}</div>
  )
}));

vi.mock('@/lib/classicPersistence', () => ({
  CLASSIC_EMPTY_STATE: {
    tags: [],
    notesById: {},
    noteOrderByTagId: {},
    activeTagId: null
  },
  loadClassicStateFromDatabase: () => mockLoadClassicStateFromDatabase(),
  createClassicTag: () => mockCreateClassicTag(),
  createClassicNote: (...args: unknown[]) => mockCreateClassicNote(...args),
  persistClassicOrderToDatabase: (...args: unknown[]) =>
    mockPersistClassicOrderToDatabase(...args)
}));

vi.mock('@rapid/classic', () => ({
  ClassicApp: ({
    onStateChange,
    onCreateTag,
    onCreateNote
  }: {
    onStateChange?: ((state: unknown) => void) | undefined;
    onCreateTag?: (() => void | Promise<void>) | undefined;
    onCreateNote?: ((tagId: string) => void | Promise<void>) | undefined;
  }) => (
    <div>
      <div data-testid="classic-app">Classic App</div>
      <button
        type="button"
        onClick={() =>
          onStateChange?.({
            tags: [{ id: 'tag-a', name: 'Tag A' }],
            notesById: {},
            noteOrderByTagId: { 'tag-a': [] },
            activeTagId: 'tag-a'
          })
        }
      >
        Trigger State Change
      </button>
      <button type="button" onClick={() => onCreateTag?.()}>
        Trigger Create Tag
      </button>
      <button type="button" onClick={() => onCreateNote?.('tag-a')}>
        Trigger Create Note
      </button>
    </div>
  )
}));

import { ClassicWorkspace } from './ClassicWorkspace';

describe('ClassicWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: true,
      isLoading: false,
      currentInstanceId: 'test-instance'
    });
    mockLoadClassicStateFromDatabase.mockResolvedValue({
      state: {
        tags: [{ id: 'tag-a', name: 'Tag A' }],
        notesById: {},
        noteOrderByTagId: { 'tag-a': [] },
        activeTagId: 'tag-a'
      },
      linkRows: [{ parentId: '__vfs_root__', childId: 'tag-a', position: 0 }]
    });
    mockPersistClassicOrderToDatabase.mockResolvedValue([
      { parentId: '__vfs_root__', childId: 'tag-a', position: 0 }
    ]);
    mockCreateClassicTag.mockResolvedValue('tag-new');
    mockCreateClassicNote.mockResolvedValue('note-new');
  });

  it('renders loading state while database is loading', () => {
    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: false,
      isLoading: true,
      currentInstanceId: 'test-instance'
    });

    render(<ClassicWorkspace />);

    expect(screen.getByText('Loading database...')).toBeInTheDocument();
  });

  it('renders inline unlock when database is locked', () => {
    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: false,
      isLoading: false,
      currentInstanceId: 'test-instance'
    });

    render(<ClassicWorkspace />);

    expect(screen.getByTestId('inline-unlock')).toHaveTextContent(
      'classic data'
    );
  });

  it('loads and renders classic app when unlocked', async () => {
    render(<ClassicWorkspace />);

    await waitFor(() => {
      expect(mockLoadClassicStateFromDatabase).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByTestId('classic-app')).toBeInTheDocument();
  });

  it('persists state changes from classic app', async () => {
    const user = userEvent.setup();
    render(<ClassicWorkspace />);

    await waitFor(() => {
      expect(mockLoadClassicStateFromDatabase).toHaveBeenCalledTimes(1);
    });

    await user.click(
      screen.getByRole('button', { name: 'Trigger State Change' })
    );

    await waitFor(() => {
      expect(mockPersistClassicOrderToDatabase).toHaveBeenCalledTimes(1);
    });
  });

  it('shows sync error when load fails', async () => {
    const consoleErrorSpy = mockConsoleError();
    mockLoadClassicStateFromDatabase.mockRejectedValue(
      new Error('load failed')
    );

    render(<ClassicWorkspace />);

    await waitFor(() => {
      expect(
        screen.getByText('Failed to sync Classic state: load failed')
      ).toBeInTheDocument();
    });

    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it('creates a tag from classic app callback', async () => {
    const user = userEvent.setup();
    render(<ClassicWorkspace />);

    await waitFor(() => {
      expect(mockLoadClassicStateFromDatabase).toHaveBeenCalledTimes(1);
    });

    await user.click(screen.getByRole('button', { name: 'Trigger Create Tag' }));

    await waitFor(() => {
      expect(mockCreateClassicTag).toHaveBeenCalledTimes(1);
      expect(mockLoadClassicStateFromDatabase).toHaveBeenCalledTimes(2);
    });
  });

  it('creates a note from classic app callback', async () => {
    const user = userEvent.setup();
    render(<ClassicWorkspace />);

    await waitFor(() => {
      expect(mockLoadClassicStateFromDatabase).toHaveBeenCalledTimes(1);
    });

    await user.click(
      screen.getByRole('button', { name: 'Trigger Create Note' })
    );

    await waitFor(() => {
      expect(mockCreateClassicNote).toHaveBeenCalledWith('tag-a');
      expect(mockLoadClassicStateFromDatabase).toHaveBeenCalledTimes(2);
    });
  });
});
