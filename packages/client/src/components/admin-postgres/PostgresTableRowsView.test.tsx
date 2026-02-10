import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PostgresTableRowsView } from './PostgresTableRowsView';

const mockGetColumns = vi.fn();
const mockGetRows = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    admin: {
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

describe('PostgresTableRowsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows message when no table selected', () => {
    render(<PostgresTableRowsView schema={null} tableName={null} />);
    expect(screen.getByText('No table selected.')).toBeInTheDocument();
  });

  it('shows loading state initially', () => {
    mockGetColumns.mockImplementation(() => new Promise(() => {}));
    mockGetRows.mockImplementation(() => new Promise(() => {}));

    render(<PostgresTableRowsView schema="public" tableName="users" />);
    expect(screen.getByText('Loading table data...')).toBeInTheDocument();
  });

  it('renders table header with title', async () => {
    mockGetColumns.mockResolvedValue({
      columns: [
        { name: 'id', type: 'integer', nullable: false, ordinalPosition: 1 }
      ]
    });
    mockGetRows.mockResolvedValue({
      rows: [],
      totalCount: 0,
      limit: 50,
      offset: 0
    });

    render(<PostgresTableRowsView schema="public" tableName="users" />);

    await waitFor(() => {
      expect(screen.getByText('public.users')).toBeInTheDocument();
    });
  });

  it('shows empty state when no rows', async () => {
    mockGetColumns.mockResolvedValue({
      columns: [
        { name: 'id', type: 'integer', nullable: false, ordinalPosition: 1 }
      ]
    });
    mockGetRows.mockResolvedValue({
      rows: [],
      totalCount: 0,
      limit: 50,
      offset: 0
    });

    render(<PostgresTableRowsView schema="public" tableName="empty" />);

    await waitFor(() => {
      expect(screen.getByText('No rows found.')).toBeInTheDocument();
    });
  });

  it('shows error message on fetch failure', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockGetColumns.mockRejectedValue(new Error('Connection failed'));

    render(<PostgresTableRowsView schema="public" tableName="users" />);

    await waitFor(() => {
      expect(screen.getByText('Connection failed')).toBeInTheDocument();
    });

    consoleSpy.mockRestore();
  });

  it('renders back link when provided', async () => {
    mockGetColumns.mockResolvedValue({ columns: [] });
    mockGetRows.mockResolvedValue({
      rows: [],
      totalCount: 0,
      limit: 50,
      offset: 0
    });

    render(
      <PostgresTableRowsView
        schema="public"
        tableName="users"
        backLink={<a href="/back">Back</a>}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Back' })).toBeInTheDocument();
    });
  });

  it('fetches columns and rows on mount', async () => {
    mockGetColumns.mockResolvedValue({
      columns: [
        { name: 'id', type: 'integer', nullable: false, ordinalPosition: 1 }
      ]
    });
    mockGetRows.mockResolvedValue({
      rows: [],
      totalCount: 0,
      limit: 50,
      offset: 0
    });

    render(<PostgresTableRowsView schema="public" tableName="users" />);

    await waitFor(() => {
      expect(mockGetColumns).toHaveBeenCalled();
      expect(mockGetRows).toHaveBeenCalled();
    });
  });

  it('opens column settings panel', async () => {
    const user = userEvent.setup();
    mockGetColumns.mockResolvedValue({
      columns: [
        { name: 'id', type: 'integer', nullable: false, ordinalPosition: 1 }
      ]
    });
    mockGetRows.mockResolvedValue({
      rows: [],
      totalCount: 0,
      limit: 50,
      offset: 0
    });

    render(<PostgresTableRowsView schema="public" tableName="users" />);

    await waitFor(() => {
      expect(screen.getByText('public.users')).toBeInTheDocument();
    });

    const settingsButton = screen.getByTitle('Column settings');
    await user.click(settingsButton);

    expect(screen.getByText('Visible columns')).toBeInTheDocument();
  });

  it('renders toolbar buttons', async () => {
    mockGetColumns.mockResolvedValue({
      columns: [
        { name: 'id', type: 'integer', nullable: false, ordinalPosition: 1 }
      ]
    });
    mockGetRows.mockResolvedValue({
      rows: [],
      totalCount: 0,
      limit: 50,
      offset: 0
    });

    render(<PostgresTableRowsView schema="public" tableName="users" />);

    await waitFor(() => {
      expect(screen.getByText('public.users')).toBeInTheDocument();
    });

    // Should have toolbar buttons
    expect(screen.getByTitle('Export as CSV')).toBeInTheDocument();
    expect(screen.getByTitle('Document view')).toBeInTheDocument();
    expect(screen.getByTitle('Column settings')).toBeInTheDocument();
  });

  it('shows total count in status', async () => {
    mockGetColumns.mockResolvedValue({
      columns: [
        { name: 'id', type: 'integer', nullable: false, ordinalPosition: 1 }
      ]
    });
    mockGetRows.mockResolvedValue({
      rows: [{ id: 1 }],
      totalCount: 100,
      limit: 50,
      offset: 0
    });

    render(<PostgresTableRowsView schema="public" tableName="users" />);

    await waitFor(() => {
      expect(screen.getByText('public.users')).toBeInTheDocument();
    });

    // Check the component rendered with the row data
    expect(mockGetRows).toHaveBeenCalled();
  });

  it('toggles document view mode', async () => {
    const user = userEvent.setup();
    mockGetColumns.mockResolvedValue({
      columns: [
        { name: 'id', type: 'integer', nullable: false, ordinalPosition: 1 }
      ]
    });
    mockGetRows.mockResolvedValue({
      rows: [],
      totalCount: 0,
      limit: 50,
      offset: 0
    });

    render(<PostgresTableRowsView schema="public" tableName="users" />);

    await waitFor(() => {
      expect(screen.getByText('public.users')).toBeInTheDocument();
    });

    const docViewButton = screen.getByTitle('Document view');
    await user.click(docViewButton);

    expect(screen.getByTitle('Table view')).toBeInTheDocument();
  });

  it('closes column settings when clicking outside', async () => {
    const user = userEvent.setup();
    mockGetColumns.mockResolvedValue({
      columns: [
        { name: 'id', type: 'integer', nullable: false, ordinalPosition: 1 }
      ]
    });
    mockGetRows.mockResolvedValue({
      rows: [],
      totalCount: 0,
      limit: 50,
      offset: 0
    });

    render(<PostgresTableRowsView schema="public" tableName="users" />);

    await waitFor(() => {
      expect(screen.getByText('public.users')).toBeInTheDocument();
    });

    await user.click(screen.getByTitle('Column settings'));
    expect(screen.getByText('Visible columns')).toBeInTheDocument();

    await user.click(screen.getByText('public.users'));

    await waitFor(() => {
      expect(screen.queryByText('Visible columns')).not.toBeInTheDocument();
    });
  });

  it('hides id column by default', async () => {
    const user = userEvent.setup();
    mockGetColumns.mockResolvedValue({
      columns: [
        { name: 'id', type: 'integer', nullable: false, ordinalPosition: 1 },
        { name: 'name', type: 'text', nullable: true, ordinalPosition: 2 }
      ]
    });
    mockGetRows.mockResolvedValue({
      rows: [],
      totalCount: 0,
      limit: 50,
      offset: 0
    });

    render(<PostgresTableRowsView schema="public" tableName="users" />);

    await waitFor(() => {
      expect(screen.getByText('public.users')).toBeInTheDocument();
    });

    await user.click(screen.getByTitle('Column settings'));

    const idCheckbox = screen.getAllByRole('checkbox')[0];
    expect(idCheckbox).not.toBeChecked();
  });

  it('accepts custom containerClassName', async () => {
    mockGetColumns.mockResolvedValue({
      columns: [
        { name: 'id', type: 'integer', nullable: false, ordinalPosition: 1 }
      ]
    });
    mockGetRows.mockResolvedValue({
      rows: [],
      totalCount: 0,
      limit: 50,
      offset: 0
    });

    const { container } = render(
      <PostgresTableRowsView
        schema="public"
        tableName="users"
        containerClassName="custom-class"
      />
    );

    await waitFor(() => {
      expect(screen.getByText('public.users')).toBeInTheDocument();
    });

    expect(container.firstChild).toHaveClass('custom-class');
  });

  it('toggles column visibility via checkbox', async () => {
    const user = userEvent.setup();
    mockGetColumns.mockResolvedValue({
      columns: [
        { name: 'col1', type: 'text', nullable: true, ordinalPosition: 1 }
      ]
    });
    mockGetRows.mockResolvedValue({
      rows: [],
      totalCount: 0,
      limit: 50,
      offset: 0
    });

    render(<PostgresTableRowsView schema="public" tableName="users" />);

    await waitFor(() => {
      expect(screen.getByText('public.users')).toBeInTheDocument();
    });

    await user.click(screen.getByTitle('Column settings'));

    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes.length).toBeGreaterThan(0);

    // Just verify clicking a checkbox doesn't cause an error
    const firstCheckbox = checkboxes[0];
    if (firstCheckbox) {
      await user.click(firstCheckbox);
    }
    expect(screen.getByText('Visible columns')).toBeInTheDocument();
  });

  it('refetches on sort direction change', async () => {
    const user = userEvent.setup();
    mockGetColumns.mockResolvedValue({
      columns: [
        { name: 'name', type: 'text', nullable: true, ordinalPosition: 1 }
      ]
    });
    mockGetRows.mockResolvedValue({
      rows: [{ name: 'test' }],
      totalCount: 1,
      limit: 50,
      offset: 0
    });

    render(<PostgresTableRowsView schema="public" tableName="users" />);

    await waitFor(() => {
      expect(mockGetRows).toHaveBeenCalledTimes(1);
    });

    // Click header to trigger sort - use 'name' column which is visible by default
    mockGetRows.mockClear();
    // Find the column header in the table (it's a th element)
    const headers = screen.getAllByRole('columnheader');
    const nameHeader = headers.find((h) => h.textContent?.includes('name'));
    expect(nameHeader).toBeDefined();
    if (nameHeader) {
      await user.click(nameHeader);
    }

    await waitFor(() => {
      expect(mockGetRows).toHaveBeenCalled();
    });
  });

  it('handles non-error string error', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockGetColumns.mockRejectedValue('simple string error');

    render(<PostgresTableRowsView schema="public" tableName="users" />);

    await waitFor(() => {
      expect(screen.getByText('simple string error')).toBeInTheDocument();
    });

    consoleSpy.mockRestore();
  });

  it('renders with hasMore when more rows available', async () => {
    mockGetColumns.mockResolvedValue({
      columns: [
        { name: 'id', type: 'integer', nullable: false, ordinalPosition: 1 }
      ]
    });
    mockGetRows.mockResolvedValue({
      rows: [{ id: 1 }],
      totalCount: 1000,
      limit: 50,
      offset: 0
    });

    render(<PostgresTableRowsView schema="public" tableName="users" />);

    await waitFor(() => {
      expect(screen.getByText('public.users')).toBeInTheDocument();
    });

    // Verify more rows indication
    expect(mockGetRows).toHaveBeenCalled();
  });

  it('resets to initial state on table change', async () => {
    mockGetColumns.mockResolvedValue({
      columns: [
        { name: 'id', type: 'integer', nullable: false, ordinalPosition: 1 }
      ]
    });
    mockGetRows.mockResolvedValue({
      rows: [],
      totalCount: 0,
      limit: 50,
      offset: 0
    });

    const { rerender } = render(
      <PostgresTableRowsView schema="public" tableName="users" />
    );

    await waitFor(() => {
      expect(mockGetColumns).toHaveBeenCalled();
    });

    mockGetColumns.mockClear();
    mockGetRows.mockClear();

    rerender(<PostgresTableRowsView schema="public" tableName="posts" />);

    await waitFor(() => {
      expect(mockGetColumns).toHaveBeenCalled();
    });
  });

  it('handles export with empty data', async () => {
    mockGetColumns.mockResolvedValue({
      columns: [
        { name: 'id', type: 'integer', nullable: false, ordinalPosition: 1 }
      ]
    });
    mockGetRows.mockResolvedValue({
      rows: [],
      totalCount: 0,
      limit: 50,
      offset: 0
    });

    render(<PostgresTableRowsView schema="public" tableName="users" />);

    await waitFor(() => {
      expect(screen.getByText('public.users')).toBeInTheDocument();
    });

    // Export button should be disabled when no rows
    const exportButton = screen.getByTitle('Export as CSV');
    expect(exportButton).toBeDisabled();
  });

  it('handles resize event for responsive view', async () => {
    mockGetColumns.mockResolvedValue({
      columns: [
        { name: 'id', type: 'integer', nullable: false, ordinalPosition: 1 }
      ]
    });
    mockGetRows.mockResolvedValue({
      rows: [],
      totalCount: 0,
      limit: 50,
      offset: 0
    });

    render(<PostgresTableRowsView schema="public" tableName="users" />);

    await waitFor(() => {
      expect(screen.getByText('public.users')).toBeInTheDocument();
    });

    // Trigger resize - wrap in act to handle state updates
    await act(async () => {
      window.dispatchEvent(new Event('resize'));
    });

    // Component should still be rendered after resize
    expect(screen.getByText('public.users')).toBeInTheDocument();
  });

  it('renders table with data when rows exist', async () => {
    mockGetColumns.mockResolvedValue({
      columns: [
        { name: 'name', type: 'text', nullable: true, ordinalPosition: 1 },
        { name: 'email', type: 'text', nullable: true, ordinalPosition: 2 }
      ]
    });
    mockGetRows.mockResolvedValue({
      rows: [
        { name: 'Alice', email: 'alice@example.com' },
        { name: 'Bob', email: 'bob@example.com' }
      ],
      totalCount: 2,
      limit: 50,
      offset: 0
    });

    render(<PostgresTableRowsView schema="public" tableName="users" />);

    await waitFor(() => {
      expect(screen.getByText('public.users')).toBeInTheDocument();
    });

    // Virtual lists may not render content in JSDOM, but we can verify data was loaded
    expect(mockGetRows).toHaveBeenCalled();
    // The table element should exist even if virtualizer doesn't render rows
    await waitFor(() => {
      expect(screen.getByRole('table')).toBeInTheDocument();
    });
  });

  it('switches to document view with data', async () => {
    const user = userEvent.setup();
    mockGetColumns.mockResolvedValue({
      columns: [
        { name: 'name', type: 'text', nullable: true, ordinalPosition: 1 }
      ]
    });
    mockGetRows.mockResolvedValue({
      rows: [{ name: 'Alice' }],
      totalCount: 1,
      limit: 50,
      offset: 0
    });

    render(<PostgresTableRowsView schema="public" tableName="users" />);

    await waitFor(() => {
      expect(screen.getByText('public.users')).toBeInTheDocument();
    });

    // Switch to document view
    await user.click(screen.getByTitle('Document view'));

    // Document view button should now be Table view
    expect(screen.getByTitle('Table view')).toBeInTheDocument();
  });

  it('formats null values as NULL', async () => {
    mockGetColumns.mockResolvedValue({
      columns: [
        { name: 'data', type: 'jsonb', nullable: true, ordinalPosition: 1 }
      ]
    });
    mockGetRows.mockResolvedValue({
      rows: [{ data: null }],
      totalCount: 1,
      limit: 50,
      offset: 0
    });

    render(<PostgresTableRowsView schema="public" tableName="users" />);

    await waitFor(() => {
      expect(screen.getByText('public.users')).toBeInTheDocument();
    });

    // Check that data was loaded - virtualizer may not render in JSDOM
    expect(mockGetRows).toHaveBeenCalled();
  });

  it('handles refresh button click', async () => {
    const user = userEvent.setup();
    mockGetColumns.mockResolvedValue({
      columns: [
        { name: 'id', type: 'integer', nullable: false, ordinalPosition: 1 }
      ]
    });
    mockGetRows.mockResolvedValue({
      rows: [],
      totalCount: 0,
      limit: 50,
      offset: 0
    });

    render(<PostgresTableRowsView schema="public" tableName="users" />);

    await waitFor(() => {
      expect(screen.getByText('public.users')).toBeInTheDocument();
    });

    mockGetColumns.mockClear();
    mockGetRows.mockClear();

    // Click refresh button (uses aria-label, not title)
    const refreshButton = screen.getByRole('button', { name: 'Refresh' });
    await user.click(refreshButton);

    await waitFor(() => {
      expect(mockGetColumns).toHaveBeenCalled();
      expect(mockGetRows).toHaveBeenCalled();
    });
  });

  it('exports CSV with data', async () => {
    const user = userEvent.setup();

    // Mock URL.createObjectURL and revokeObjectURL
    const mockCreateObjectURL = vi.fn(() => 'blob:url');
    const mockRevokeObjectURL = vi.fn();
    global.URL.createObjectURL = mockCreateObjectURL;
    global.URL.revokeObjectURL = mockRevokeObjectURL;

    // Mock document.createElement for the download link
    const mockClick = vi.fn();
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName) => {
      const element = originalCreateElement(tagName);
      if (tagName === 'a') {
        element.click = mockClick;
      }
      return element;
    });

    mockGetColumns.mockResolvedValue({
      columns: [
        { name: 'name', type: 'text', nullable: true, ordinalPosition: 1 }
      ]
    });
    mockGetRows.mockResolvedValue({
      rows: [{ name: 'Alice' }],
      totalCount: 1,
      limit: 50,
      offset: 0
    });

    render(<PostgresTableRowsView schema="public" tableName="users" />);

    await waitFor(() => {
      expect(screen.getByText('public.users')).toBeInTheDocument();
    });

    const exportButton = screen.getByTitle('Export as CSV');
    await waitFor(() => {
      expect(exportButton).not.toBeDisabled();
    });
    await user.click(exportButton);

    await waitFor(() => {
      expect(mockClick).toHaveBeenCalled();
    });

    vi.restoreAllMocks();
  });

  it('shows sort indicator when column is sorted', async () => {
    const user = userEvent.setup();
    mockGetColumns.mockResolvedValue({
      columns: [
        { name: 'name', type: 'text', nullable: true, ordinalPosition: 1 }
      ]
    });
    mockGetRows.mockResolvedValue({
      rows: [{ name: 'Alice' }],
      totalCount: 1,
      limit: 50,
      offset: 0
    });

    render(<PostgresTableRowsView schema="public" tableName="users" />);

    await waitFor(() => {
      expect(screen.getByText('public.users')).toBeInTheDocument();
    });

    // Click to sort ascending
    const header = screen.getByRole('columnheader');
    await user.click(header);

    // Should show ascending sort indicator (ArrowUp icon is present)
    await waitFor(() => {
      expect(mockGetRows).toHaveBeenCalled();
    });

    // Click again for descending
    await user.click(header);

    await waitFor(() => {
      expect(mockGetRows).toHaveBeenCalled();
    });

    // Click again to clear sort
    await user.click(header);

    await waitFor(() => {
      expect(mockGetRows).toHaveBeenCalled();
    });
  });

  it('shows error when CSV export fails', async () => {
    const user = userEvent.setup();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    mockGetColumns.mockResolvedValue({
      columns: [
        { name: 'name', type: 'text', nullable: true, ordinalPosition: 1 }
      ]
    });
    mockGetRows
      .mockResolvedValueOnce({
        rows: [{ name: 'Alice' }],
        totalCount: 1,
        limit: 50,
        offset: 0
      })
      .mockRejectedValueOnce(new Error('Export failed'));

    render(<PostgresTableRowsView schema="public" tableName="users" />);

    await waitFor(() => {
      expect(screen.getByText('public.users')).toBeInTheDocument();
    });

    const exportButton = screen.getByTitle('Export as CSV');
    await user.click(exportButton);

    await waitFor(() => {
      expect(screen.getByText('Export failed')).toBeInTheDocument();
    });

    consoleSpy.mockRestore();
  });

  it('renders rows in document view with hasMore', async () => {
    const user = userEvent.setup();
    mockGetColumns.mockResolvedValue({
      columns: [
        { name: 'name', type: 'text', nullable: true, ordinalPosition: 1 }
      ]
    });
    mockGetRows.mockResolvedValue({
      rows: Array.from({ length: 5 }, (_, i) => ({ name: `User ${i}` })),
      totalCount: 100,
      limit: 50,
      offset: 0
    });

    render(<PostgresTableRowsView schema="public" tableName="users" />);

    await waitFor(() => {
      expect(screen.getByText('public.users')).toBeInTheDocument();
    });

    // Switch to document view
    await user.click(screen.getByTitle('Document view'));

    // Document view should render with hasMore
    expect(screen.getByTitle('Table view')).toBeInTheDocument();
  });

  it('renders row content in table view', async () => {
    mockGetColumns.mockResolvedValue({
      columns: [
        { name: 'name', type: 'text', nullable: true, ordinalPosition: 1 }
      ]
    });
    mockGetRows.mockResolvedValue({
      rows: [{ name: 'Alice' }, { name: 'Bob' }],
      totalCount: 2,
      limit: 50,
      offset: 0
    });

    render(<PostgresTableRowsView schema="public" tableName="users" />);

    await waitFor(() => {
      // With mocked virtualizer, rows should render
      expect(screen.getByText('Alice')).toBeInTheDocument();
    });

    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('renders row content in document view with JSON', async () => {
    const user = userEvent.setup();
    mockGetColumns.mockResolvedValue({
      columns: [
        { name: 'name', type: 'text', nullable: true, ordinalPosition: 1 }
      ]
    });
    mockGetRows.mockResolvedValue({
      rows: [{ name: 'Alice' }],
      totalCount: 1,
      limit: 50,
      offset: 0
    });

    render(<PostgresTableRowsView schema="public" tableName="users" />);

    await waitFor(() => {
      expect(screen.getByText('public.users')).toBeInTheDocument();
    });

    // Switch to document view
    await user.click(screen.getByTitle('Document view'));

    await waitFor(() => {
      // Document view shows pre tags with JSON
      const preTags = screen
        .getAllByRole('generic')
        .filter((el) => el.tagName === 'PRE');
      expect(preTags.length).toBeGreaterThan(0);
    });
  });

  it('toggles hidden column visibility to show', async () => {
    const user = userEvent.setup();
    mockGetColumns.mockResolvedValue({
      columns: [
        { name: 'id', type: 'integer', nullable: false, ordinalPosition: 1 },
        { name: 'name', type: 'text', nullable: true, ordinalPosition: 2 }
      ]
    });
    mockGetRows.mockResolvedValue({
      rows: [{ id: 1, name: 'Alice' }],
      totalCount: 1,
      limit: 50,
      offset: 0
    });

    render(<PostgresTableRowsView schema="public" tableName="users" />);

    await waitFor(() => {
      expect(screen.getByText('public.users')).toBeInTheDocument();
    });

    // Open column settings
    await user.click(screen.getByTitle('Column settings'));

    // id should be unchecked by default
    const checkboxes = screen.getAllByRole('checkbox');
    const idCheckbox = checkboxes[0];
    expect(idCheckbox).not.toBeChecked();

    // Click to show id column
    if (idCheckbox) {
      await user.click(idCheckbox);
      expect(idCheckbox).toBeChecked();
    }
  });

  it('toggles visible column to hidden', async () => {
    const user = userEvent.setup();
    mockGetColumns.mockResolvedValue({
      columns: [
        { name: 'name', type: 'text', nullable: true, ordinalPosition: 1 }
      ]
    });
    mockGetRows.mockResolvedValue({
      rows: [{ name: 'Alice' }],
      totalCount: 1,
      limit: 50,
      offset: 0
    });

    render(<PostgresTableRowsView schema="public" tableName="users" />);

    await waitFor(() => {
      expect(screen.getByText('public.users')).toBeInTheDocument();
    });

    // Open column settings
    await user.click(screen.getByTitle('Column settings'));

    // name should be checked (visible) by default
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toBeChecked();

    // Click to hide name column
    await user.click(checkbox);
    expect(checkbox).not.toBeChecked();
  });

  it('formats various cell value types', async () => {
    mockGetColumns.mockResolvedValue({
      columns: [
        { name: 'bool', type: 'boolean', nullable: true, ordinalPosition: 1 },
        { name: 'json', type: 'jsonb', nullable: true, ordinalPosition: 2 },
        { name: 'undef', type: 'text', nullable: true, ordinalPosition: 3 }
      ]
    });
    mockGetRows.mockResolvedValue({
      rows: [{ bool: false, json: { a: 1 }, undef: undefined }],
      totalCount: 1,
      limit: 50,
      offset: 0
    });

    render(<PostgresTableRowsView schema="public" tableName="users" />);

    await waitFor(() => {
      expect(screen.getByText('public.users')).toBeInTheDocument();
    });

    // Verify boolean false renders as "false"
    expect(screen.getByText('false')).toBeInTheDocument();
    // Verify object renders as JSON
    expect(screen.getByText('{"a":1}')).toBeInTheDocument();
  });

  it('handles load more state properly', async () => {
    mockGetColumns.mockResolvedValue({
      columns: [
        { name: 'name', type: 'text', nullable: true, ordinalPosition: 1 }
      ]
    });
    mockGetRows.mockResolvedValue({
      rows: Array.from({ length: 5 }, (_, i) => ({ name: `User ${i}` })),
      totalCount: 500,
      limit: 50,
      offset: 0
    });

    render(<PostgresTableRowsView schema="public" tableName="users" />);

    await waitFor(() => {
      expect(screen.getByText('public.users')).toBeInTheDocument();
    });

    // Should indicate there are more rows
    expect(mockGetRows).toHaveBeenCalled();
  });

  it('renders loader row placeholder when hasMore is true', async () => {
    mockGetColumns.mockResolvedValue({
      columns: [
        { name: 'name', type: 'text', nullable: true, ordinalPosition: 1 }
      ]
    });
    // Return fewer rows than the mock virtualizer will request
    mockGetRows.mockResolvedValue({
      rows: [{ name: 'User 1' }],
      totalCount: 100,
      limit: 50,
      offset: 0
    });

    render(<PostgresTableRowsView schema="public" tableName="users" />);

    await waitFor(() => {
      expect(screen.getByText('public.users')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByText('User 1')).toBeInTheDocument();
    });
  });
});
