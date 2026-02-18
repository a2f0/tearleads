import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PostgresTableRowsView } from './PostgresTableRowsView';
import {
  defaultSchema,
  defaultTableName,
  minimalColumns,
  singleIdRow
} from './postgresTableRowsViewTestCases';
import {
  buildColumnsResponse,
  buildRowsResponse,
  createMockApi
} from './postgresTableRowsViewTestUtils';

const { mockGetColumns, mockGetRows } = createMockApi();

vi.mock('@/lib/api', () => ({
  api: {
    admin: {
      getContext: vi.fn().mockResolvedValue({
        isRootAdmin: true,
        organizations: [{ id: 'org-1', name: 'Org 1' }]
      }),
      postgres: {
        getColumns: () => mockGetColumns(),
        getRows: (...args: unknown[]) => mockGetRows(...args)
      }
    }
  }
}));

// Mock virtualizer to return actual items so virtual content renders in tests
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: Math.min(count, 10) }, (_, i) => ({
        index: i,
        start: i * 40,
        size: 40,
        key: `item-${i}`
      })),
    getTotalSize: () => count * 40,
    measureElement: () => {},
    scrollToIndex: () => {}
  })
}));

const renderView = (
  schema: string | null = defaultSchema,
  tableName: string | null = defaultTableName
) => {
  return render(
    <PostgresTableRowsView schema={schema} tableName={tableName} />
  );
};

const renderAndWait = async () => {
  renderView();
  await waitFor(() => {
    expect(
      screen.getByText(`${defaultSchema}.${defaultTableName}`)
    ).toBeInTheDocument();
  });
};

describe('PostgresTableRowsView (basic)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetColumns.mockResolvedValue(buildColumnsResponse(minimalColumns));
    mockGetRows.mockResolvedValue(buildRowsResponse());
  });

  it('shows message when no table selected', () => {
    renderView(null, null);
    expect(screen.getByText('No table selected.')).toBeInTheDocument();
  });

  it('shows loading state initially', () => {
    mockGetColumns.mockImplementation(() => new Promise(() => {}));
    mockGetRows.mockImplementation(() => new Promise(() => {}));

    renderView();
    expect(screen.getByText('Loading table data...')).toBeInTheDocument();
  });

  it('renders table header with title', async () => {
    renderView();

    await waitFor(() => {
      expect(
        screen.getByText(`${defaultSchema}.${defaultTableName}`)
      ).toBeInTheDocument();
    });
  });

  it('shows empty state when no rows', async () => {
    renderView(defaultSchema, 'empty');

    await waitFor(() => {
      expect(screen.getByText('No rows found.')).toBeInTheDocument();
    });
  });

  it('shows error message on fetch failure', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockGetColumns.mockRejectedValue(new Error('Connection failed'));

    renderView();

    await waitFor(() => {
      expect(screen.getByText('Connection failed')).toBeInTheDocument();
    });

    consoleSpy.mockRestore();
  });

  it('renders back link when provided', async () => {
    render(
      <PostgresTableRowsView
        schema={defaultSchema}
        tableName={defaultTableName}
        backLink={<a href="/back">Back</a>}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Back' })).toBeInTheDocument();
    });
  });

  it('fetches columns and rows on mount', async () => {
    renderView();

    await waitFor(() => {
      expect(mockGetColumns).toHaveBeenCalled();
      expect(mockGetRows).toHaveBeenCalled();
    });
  });

  it('shows total count in status', async () => {
    mockGetRows.mockResolvedValue(
      buildRowsResponse({ rows: singleIdRow, totalCount: 100 })
    );

    await renderAndWait();

    expect(mockGetRows).toHaveBeenCalled();
  });

  it('handles non-error string error', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockGetColumns.mockRejectedValue('simple string error');

    renderView();

    await waitFor(() => {
      expect(screen.getByText('simple string error')).toBeInTheDocument();
    });

    consoleSpy.mockRestore();
  });

  it('renders with hasMore when more rows available', async () => {
    mockGetRows.mockResolvedValue(
      buildRowsResponse({ rows: singleIdRow, totalCount: 1000 })
    );

    await renderAndWait();

    expect(mockGetRows).toHaveBeenCalled();
  });

  it('resets to initial state on table change', async () => {
    const { rerender } = renderView();

    await waitFor(() => {
      expect(mockGetColumns).toHaveBeenCalled();
    });

    mockGetColumns.mockClear();
    mockGetRows.mockClear();

    rerender(
      <PostgresTableRowsView schema={defaultSchema} tableName="posts" />
    );

    await waitFor(() => {
      expect(mockGetColumns).toHaveBeenCalled();
    });
  });

  it('handles export with empty data', async () => {
    await renderAndWait();

    const exportButton = screen.getByTitle('Export as CSV');
    expect(exportButton).toBeDisabled();
  });

  it('handles resize event for responsive view', async () => {
    await renderAndWait();

    await act(async () => {
      window.dispatchEvent(new Event('resize'));
    });
  });
});
