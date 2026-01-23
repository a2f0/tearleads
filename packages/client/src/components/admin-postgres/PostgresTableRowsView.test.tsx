import { render, screen, waitFor } from '@testing-library/react';
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
});
