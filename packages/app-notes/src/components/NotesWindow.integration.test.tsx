import { type Database, schema } from '@tearleads/db/sqlite';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type {
  NotesUIComponents,
  VfsItemSyncFunctions
} from '../context/NotesContext';
import { NotesProvider } from '../context/NotesContext';
import { NotesWindow } from './NotesWindow';

vi.mock('@tearleads/ui', () => ({
  useTheme: () => ({ resolvedTheme: 'light' })
}));

vi.mock('@uiw/react-md-editor', () => ({
  default: ({
    value,
    onChange
  }: {
    value?: string;
    onChange?: (value?: string) => void;
  }) => (
    <textarea
      data-testid="mock-md-editor"
      value={value ?? ''}
      onChange={(event) => onChange?.(event.target.value)}
    />
  )
}));

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: index,
        start: index * 56,
        end: (index + 1) * 56,
        size: 56,
        lane: 0
      })),
    getTotalSize: () => count * 56,
    measureElement: () => undefined
  })
}));

vi.mock('@tearleads/window-manager', () => ({
  FloatingWindow: ({ children }: { children: ReactNode }) => (
    <div data-testid="floating-window">{children}</div>
  ),
  WindowControlBar: ({ children }: { children: ReactNode }) => (
    <div data-testid="control-bar">{children}</div>
  ),
  WindowMenuBar: ({ children }: { children: ReactNode }) => (
    <div data-testid="window-menu-bar">{children}</div>
  ),
  WindowControlGroup: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  WindowControlButton: ({
    children,
    onClick,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" onClick={onClick} {...props}>
      {children}
    </button>
  ),
  WindowPaneState: ({
    title,
    action
  }: {
    title: string;
    action?: ReactNode;
  }) => (
    <div data-testid="window-pane-state">
      <span>{title}</span>
      {action}
    </div>
  ),
  WINDOW_TABLE_TYPOGRAPHY: {
    table: 'table',
    header: 'header',
    headerCell: 'header-cell',
    cell: 'cell',
    mutedCell: 'muted-cell'
  },
  WindowTableRow: ({
    children,
    onClick,
    onContextMenu
  }: {
    children: ReactNode;
    onClick?: () => void;
    onContextMenu?: (event: React.MouseEvent) => void;
  }) => (
    <tr onClick={onClick} onContextMenu={onContextMenu}>
      {children}
    </tr>
  ),
  useSidebarRefetch: vi.fn()
}));

interface MutableNote {
  id: string;
  title: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  deleted: boolean;
}

function createUiComponents(): NotesUIComponents {
  return {
    Button: ({ children, ...props }) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
    Input: (props) => <input {...props} />,
    ContextMenu: ({ children }) => <div>{children}</div>,
    ContextMenuItem: ({
      children,
      onClick
    }: {
      children: ReactNode;
      onClick: () => void;
    }) => (
      <button type="button" onClick={onClick}>
        {children}
      </button>
    ),
    ListRow: ({ children }) => <div>{children}</div>,
    RefreshButton: ({ onClick }) => (
      <button type="button" onClick={onClick}>
        Refresh
      </button>
    ),
    VirtualListStatus: () => <div>status</div>,
    InlineUnlock: ({ description }) => <div>Unlock {description}</div>,
    EditableTitle: ({ value }) => (
      <div data-testid="editable-title">{value}</div>
    ),
    DropdownMenu: ({ trigger, children }) => (
      <div data-testid={`dropdown-${trigger.toLowerCase()}`}>{children}</div>
    ),
    DropdownMenuItem: ({ children, onClick }) => (
      <button type="button" onClick={onClick}>
        {children}
      </button>
    ),
    DropdownMenuSeparator: () => <hr />,
    WindowOptionsMenuItem: () => <div>Options</div>,
    AboutMenuItem: () => <div>About</div>,
    BackLink: ({ defaultLabel }) => <a href="/notes">{defaultLabel}</a>
  };
}

async function openSharedNoteFromList(): Promise<void> {
  await waitFor(() => {
    expect(screen.getByText('Shared note')).toBeInTheDocument();
  });
  await act(async () => {
    fireEvent.click(screen.getByText('Shared note'));
    await Promise.resolve();
  });
  await waitFor(() => {
    expect(screen.getByTestId('mock-md-editor')).toBeInTheDocument();
  });
}

function createStatefulDatabase(initialNote: MutableNote): {
  db: Database;
  readNote: () => MutableNote;
} {
  const state: MutableNote = { ...initialNote };
  const db = drizzle(
    async (
      sql: string,
      params: unknown[],
      _method: 'all' | 'get' | 'run' | 'values'
    ): Promise<{ rows: unknown[] }> => {
      const sqlLower = sql.toLowerCase();

      if (sqlLower.startsWith('select') && sqlLower.includes('from "notes"')) {
        const idParam = params.find(
          (value): value is string => typeof value === 'string'
        );
        if (idParam && idParam !== state.id) {
          return { rows: [] };
        }

        const deletedFilterParam = params.find(
          (value): value is number | boolean =>
            typeof value === 'number' || typeof value === 'boolean'
        );
        if (
          (deletedFilterParam === 0 || deletedFilterParam === false) &&
          state.deleted
        ) {
          return { rows: [] };
        }

        const selectClause = sqlLower.split('from "notes"')[0] ?? '';
        const includesDeletedColumn =
          selectClause.includes('"notes"."deleted"');
        const baseValues: unknown[] = [
          state.id,
          state.title,
          state.content,
          state.createdAt.getTime(),
          state.updatedAt.getTime()
        ];
        if (includesDeletedColumn) {
          baseValues.push(state.deleted ? 1 : 0);
        }
        return { rows: [baseValues] };
      }

      if (sqlLower.startsWith('update "notes"')) {
        const whereId = params[params.length - 1];
        if (whereId !== state.id) {
          return { rows: [] };
        }

        const maybeUpdatedAt = params[1];
        if (typeof maybeUpdatedAt === 'number') {
          state.updatedAt = new Date(maybeUpdatedAt);
        } else if (
          typeof maybeUpdatedAt === 'string' ||
          maybeUpdatedAt instanceof Date
        ) {
          state.updatedAt = new Date(maybeUpdatedAt);
        }

        if (sqlLower.includes('"content"')) {
          state.content = String(params[0] ?? '');
        }
        if (sqlLower.includes('"title"')) {
          state.title = String(params[0] ?? '');
        }
        if (sqlLower.includes('"deleted"')) {
          state.deleted = params[0] === 1 || params[0] === true;
        }

        return { rows: [] };
      }

      return { rows: [] };
    },
    { schema }
  );

  return {
    db,
    readNote: () => ({ ...state })
  };
}

describe('NotesWindow integration', () => {
  it('persists content + queues sync when user edits, closes, and reopens', async () => {
    const initialNote: MutableNote = {
      id: 'note-1',
      title: 'Shared note',
      content: 'original',
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
      updatedAt: new Date('2026-03-01T00:00:00.000Z'),
      deleted: false
    };
    const { db, readNote } = createStatefulDatabase(initialNote);

    const queueItemUpsertAndFlush = vi.fn(async () => undefined);
    const queueItemDeleteAndFlush = vi.fn(async () => undefined);
    const vfsItemSync: VfsItemSyncFunctions = {
      queueItemUpsertAndFlush,
      queueItemDeleteAndFlush
    };

    render(
      <NotesProvider
        databaseState={{
          isUnlocked: true,
          isLoading: false,
          currentInstanceId: 'instance-1'
        }}
        getDatabase={() => db}
        ui={createUiComponents()}
        t={(key) => key}
        vfsItemSync={vfsItemSync}
      >
        <NotesWindow
          id="notes-window"
          onClose={vi.fn()}
          onMinimize={vi.fn()}
          onFocus={vi.fn()}
          zIndex={10}
        />
      </NotesProvider>
    );

    await openSharedNoteFromList();

    fireEvent.change(screen.getByTestId('mock-md-editor'), {
      target: { value: 'alice edited content' }
    });

    // Close detail immediately (before debounce timer fires) to exercise
    // unmount-save behavior seen in real close/reopen workflows.
    fireEvent.click(screen.getByTestId('notes-window-control-back'));

    await openSharedNoteFromList();
    await waitFor(() => {
      expect(
        screen.getByDisplayValue('alice edited content')
      ).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(readNote().content).toBe('alice edited content');
      expect(vfsItemSync.queueItemUpsertAndFlush).toHaveBeenCalled();
    });

    const upsertCalls = queueItemUpsertAndFlush.mock.calls;
    const lastCall = upsertCalls[upsertCalls.length - 1];
    if (!lastCall) {
      throw new Error('Expected at least one sync upsert call');
    }
    expect(lastCall[0]).toMatchObject({
      itemId: 'note-1',
      objectType: 'note',
      payload: expect.objectContaining({
        id: 'note-1',
        objectType: 'note',
        title: 'Shared note',
        content: 'alice edited content',
        deleted: false
      })
    });
  });

  it('keeps saved content after debounce save and reopen', async () => {
    const initialNote: MutableNote = {
      id: 'note-1',
      title: 'Shared note',
      content: 'original',
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
      updatedAt: new Date('2026-03-01T00:00:00.000Z'),
      deleted: false
    };
    const { db, readNote } = createStatefulDatabase(initialNote);

    const queueItemUpsertAndFlush = vi.fn(async () => undefined);
    const queueItemDeleteAndFlush = vi.fn(async () => undefined);
    const vfsItemSync: VfsItemSyncFunctions = {
      queueItemUpsertAndFlush,
      queueItemDeleteAndFlush
    };

    render(
      <NotesProvider
        databaseState={{
          isUnlocked: true,
          isLoading: false,
          currentInstanceId: 'instance-1'
        }}
        getDatabase={() => db}
        ui={createUiComponents()}
        t={(key) => key}
        vfsItemSync={vfsItemSync}
      >
        <NotesWindow
          id="notes-window"
          onClose={vi.fn()}
          onMinimize={vi.fn()}
          onFocus={vi.fn()}
          zIndex={10}
        />
      </NotesProvider>
    );

    await openSharedNoteFromList();

    fireEvent.change(screen.getByTestId('mock-md-editor'), {
      target: { value: 'saved by debounce' }
    });

    await waitFor(() => {
      expect(readNote().content).toBe('saved by debounce');
      expect(queueItemUpsertAndFlush).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByTestId('notes-window-control-back'));
    await openSharedNoteFromList();

    await waitFor(() => {
      expect(screen.getByDisplayValue('saved by debounce')).toBeInTheDocument();
    });
  });
});
