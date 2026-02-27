import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockConsoleError } from '@/test/consoleMocks';

const mockUseDatabaseContext = vi.fn();
const mockLoadClassicStateFromDatabase = vi.fn();
const mockPersistClassicOrderToDatabase = vi.fn();
const mockDeleteClassicTag = vi.fn();
const mockRestoreClassicTag = vi.fn();
const mockUseOrg = vi.fn();

vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockUseDatabaseContext()
}));

vi.mock('@/contexts/OrgContext', () => ({
  useOrg: () => mockUseOrg()
}));

vi.mock('@/components/sqlite/InlineUnlock', () => ({
  InlineUnlock: ({ description }: { description: string }) => (
    <div data-testid="inline-unlock">{description}</div>
  )
}));

vi.mock('@/lib/classicPersistence', () => ({
  CLASSIC_EMPTY_STATE: {
    tags: [],
    deletedTags: [],
    notesById: {},
    noteOrderByTagId: {},
    activeTagId: null
  },
  loadClassicStateFromDatabase: (...args: unknown[]) =>
    mockLoadClassicStateFromDatabase(...args),
  persistClassicOrderToDatabase: (...args: unknown[]) =>
    mockPersistClassicOrderToDatabase(...args),
  deleteClassicTag: (...args: unknown[]) => mockDeleteClassicTag(...args),
  restoreClassicTag: (...args: unknown[]) => mockRestoreClassicTag(...args)
}));

vi.mock('@tearleads/classic', () => ({
  ClassicApp: ({
    tagSortOrder,
    entrySortOrder,
    showSortControls,
    onStateChange,
    onDeleteTag,
    onRestoreTag
  }: {
    tagSortOrder?: string;
    entrySortOrder?: string;
    showSortControls?: boolean;
    onStateChange?: ((state: unknown) => void) | undefined;
    onDeleteTag?: ((tagId: string) => Promise<void>) | undefined;
    onRestoreTag?: ((tagId: string) => Promise<void>) | undefined;
  }) => (
    <div>
      <div data-testid="classic-app">Classic App</div>
      <div data-testid="classic-app-tag-sort">{tagSortOrder ?? 'unset'}</div>
      <div data-testid="classic-app-entry-sort">
        {entrySortOrder ?? 'unset'}
      </div>
      <div data-testid="classic-app-show-sort-controls">
        {showSortControls === undefined ? 'unset' : String(showSortControls)}
      </div>
      <button
        type="button"
        onClick={() =>
          onStateChange?.({
            tags: [{ id: 'tag-a', name: 'Tag A' }],
            deletedTags: [],
            notesById: {},
            noteOrderByTagId: { 'tag-a': [] },
            activeTagId: 'tag-a'
          })
        }
      >
        Trigger State Change
      </button>
      <button type="button" onClick={() => void onDeleteTag?.('tag-a')}>
        Trigger Delete Tag
      </button>
      <button type="button" onClick={() => void onRestoreTag?.('tag-a')}>
        Trigger Restore Tag
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
    mockUseOrg.mockReturnValue({
      activeOrganizationId: null,
      organizations: [],
      setActiveOrganizationId: vi.fn(),
      isLoading: false
    });
    mockLoadClassicStateFromDatabase.mockResolvedValue({
      state: {
        tags: [{ id: 'tag-a', name: 'Tag A' }],
        deletedTags: [],
        notesById: {},
        noteOrderByTagId: { 'tag-a': [] },
        activeTagId: 'tag-a'
      },
      linkRows: [{ parentId: '__vfs_root__', childId: 'tag-a', position: 0 }]
    });
    mockPersistClassicOrderToDatabase.mockResolvedValue([
      { parentId: '__vfs_root__', childId: 'tag-a', position: 0 }
    ]);
    mockDeleteClassicTag.mockResolvedValue(undefined);
    mockRestoreClassicTag.mockResolvedValue(undefined);
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

    expect(await screen.findByTestId('classic-app')).toBeInTheDocument();
  });

  it('keeps ClassicApp internal sort controls when no external sort props are passed', async () => {
    render(<ClassicWorkspace />);

    await waitFor(() => {
      expect(mockLoadClassicStateFromDatabase).toHaveBeenCalledTimes(1);
    });

    expect(await screen.findByTestId('classic-app-tag-sort')).toHaveTextContent(
      'unset'
    );
    expect(screen.getByTestId('classic-app-entry-sort')).toHaveTextContent(
      'unset'
    );
    expect(
      screen.getByTestId('classic-app-show-sort-controls')
    ).toHaveTextContent('unset');
  });

  it('hides ClassicApp internal sort controls when externally controlled', async () => {
    const onTagSortOrderChange = vi.fn();
    const onEntrySortOrderChange = vi.fn();
    render(
      <ClassicWorkspace
        tagSortOrder="user-defined"
        entrySortOrder="user-defined"
        onTagSortOrderChange={onTagSortOrderChange}
        onEntrySortOrderChange={onEntrySortOrderChange}
      />
    );

    await waitFor(() => {
      expect(mockLoadClassicStateFromDatabase).toHaveBeenCalledTimes(1);
    });

    expect(await screen.findByTestId('classic-app-tag-sort')).toHaveTextContent(
      'user-defined'
    );
    expect(screen.getByTestId('classic-app-entry-sort')).toHaveTextContent(
      'user-defined'
    );
    expect(
      screen.getByTestId('classic-app-show-sort-controls')
    ).toHaveTextContent('false');
  });

  it('persists state changes from classic app', async () => {
    const user = userEvent.setup();
    render(<ClassicWorkspace />);

    await waitFor(() => {
      expect(mockLoadClassicStateFromDatabase).toHaveBeenCalledTimes(1);
    });

    await user.click(
      await screen.findByRole('button', { name: 'Trigger State Change' })
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

  it('shows sync error when persist fails', async () => {
    const user = userEvent.setup();
    const consoleErrorSpy = mockConsoleError();
    mockPersistClassicOrderToDatabase.mockRejectedValue(
      new Error('persist failed')
    );

    render(<ClassicWorkspace />);

    await waitFor(() => {
      expect(mockLoadClassicStateFromDatabase).toHaveBeenCalledTimes(1);
    });

    await user.click(
      await screen.findByRole('button', { name: 'Trigger State Change' })
    );

    await waitFor(() => {
      expect(
        screen.getByText('Failed to sync Classic state: persist failed')
      ).toBeInTheDocument();
    });

    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it('deletes a tag and refreshes classic state', async () => {
    const user = userEvent.setup();
    render(<ClassicWorkspace />);

    await waitFor(() => {
      expect(mockLoadClassicStateFromDatabase).toHaveBeenCalledTimes(1);
    });

    await user.click(
      await screen.findByRole('button', { name: 'Trigger Delete Tag' })
    );

    await waitFor(() => {
      expect(mockDeleteClassicTag).toHaveBeenCalledWith('tag-a');
    });

    await waitFor(() => {
      expect(mockLoadClassicStateFromDatabase).toHaveBeenCalledTimes(2);
    });
  });

  it('passes activeOrganizationId to loadClassicStateFromDatabase', async () => {
    mockUseOrg.mockReturnValue({
      activeOrganizationId: 'org-abc',
      organizations: [],
      setActiveOrganizationId: vi.fn(),
      isLoading: false
    });

    render(<ClassicWorkspace />);

    await waitFor(() => {
      expect(mockLoadClassicStateFromDatabase).toHaveBeenCalledTimes(1);
    });

    expect(mockLoadClassicStateFromDatabase).toHaveBeenCalledWith('org-abc');
  });

  it('restores a tag and refreshes classic state', async () => {
    const user = userEvent.setup();
    render(<ClassicWorkspace />);

    await waitFor(() => {
      expect(mockLoadClassicStateFromDatabase).toHaveBeenCalledTimes(1);
    });

    await user.click(
      await screen.findByRole('button', { name: 'Trigger Restore Tag' })
    );

    await waitFor(() => {
      expect(mockRestoreClassicTag).toHaveBeenCalledWith('tag-a');
    });

    await waitFor(() => {
      expect(mockLoadClassicStateFromDatabase).toHaveBeenCalledTimes(2);
    });
  });
});
