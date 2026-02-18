import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PostgresTableRowsView } from './PostgresTableRowsView';
import {
  defaultSchema,
  defaultTableName,
  emailColumns,
  idNameColumns,
  nameColumns,
  singleIdRow,
  singleNameRow
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

const renderAndWait = async () => {
  render(
    <PostgresTableRowsView
      schema={defaultSchema}
      tableName={defaultTableName}
    />
  );
  await waitFor(() => {
    expect(
      screen.getByText(`${defaultSchema}.${defaultTableName}`)
    ).toBeInTheDocument();
  });
};

describe('PostgresTableRowsView (interactions)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetColumns.mockResolvedValue(buildColumnsResponse(idNameColumns));
    mockGetRows.mockResolvedValue(buildRowsResponse());
  });

  it('opens column settings panel', async () => {
    const user = userEvent.setup();
    await renderAndWait();

    const settingsButton = screen.getByTitle('Column settings');
    await user.click(settingsButton);

    expect(screen.getByText('Visible columns')).toBeInTheDocument();
  });

  it('renders toolbar buttons', async () => {
    await renderAndWait();

    expect(screen.getByTitle('Export as CSV')).toBeInTheDocument();
    expect(screen.getByTitle('Document view')).toBeInTheDocument();
    expect(screen.getByTitle('Column settings')).toBeInTheDocument();
  });

  it('toggles document view mode', async () => {
    const user = userEvent.setup();
    await renderAndWait();

    const docViewButton = screen.getByTitle('Document view');
    await user.click(docViewButton);

    expect(screen.getByTitle('Table view')).toBeInTheDocument();
  });

  it('closes column settings when clicking outside', async () => {
    const user = userEvent.setup();
    await renderAndWait();

    await user.click(screen.getByTitle('Column settings'));
    expect(screen.getByText('Visible columns')).toBeInTheDocument();

    await user.click(screen.getByText(`${defaultSchema}.${defaultTableName}`));

    await waitFor(() => {
      expect(screen.queryByText('Visible columns')).not.toBeInTheDocument();
    });
  });

  it('hides id column by default', async () => {
    const user = userEvent.setup();
    mockGetColumns.mockResolvedValue(buildColumnsResponse(idNameColumns));

    await renderAndWait();

    await user.click(screen.getByTitle('Column settings'));

    const idCheckbox = screen.getAllByRole('checkbox')[0];
    expect(idCheckbox).not.toBeChecked();
  });

  it('accepts custom containerClassName', async () => {
    const { container } = render(
      <PostgresTableRowsView
        schema={defaultSchema}
        tableName={defaultTableName}
        containerClassName="custom-class"
      />
    );

    await waitFor(() => {
      expect(
        screen.getByText(`${defaultSchema}.${defaultTableName}`)
      ).toBeInTheDocument();
    });

    expect(container.firstChild).toHaveClass('custom-class');
  });

  it('toggles column visibility via checkbox', async () => {
    const user = userEvent.setup();
    mockGetColumns.mockResolvedValue(
      buildColumnsResponse([
        { name: 'col1', type: 'text', nullable: true, ordinalPosition: 1 }
      ])
    );

    await renderAndWait();

    await user.click(screen.getByTitle('Column settings'));

    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes.length).toBeGreaterThan(0);

    const firstCheckbox = checkboxes[0];
    if (firstCheckbox) {
      await user.click(firstCheckbox);
    }
    expect(screen.getByText('Visible columns')).toBeInTheDocument();
  });

  it('refetches on sort direction change', async () => {
    const user = userEvent.setup();
    mockGetColumns.mockResolvedValue(buildColumnsResponse(nameColumns));
    mockGetRows.mockResolvedValue(
      buildRowsResponse({ rows: singleNameRow, totalCount: 1 })
    );

    render(
      <PostgresTableRowsView
        schema={defaultSchema}
        tableName={defaultTableName}
      />
    );

    await waitFor(() => {
      expect(mockGetRows).toHaveBeenCalledTimes(1);
    });

    mockGetRows.mockClear();
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

  it('fetches more rows after scrolling', async () => {
    mockGetRows.mockResolvedValue(
      buildRowsResponse({ rows: singleIdRow, totalCount: 1000 })
    );

    await renderAndWait();

    const scrollElement = screen.getByTestId('scroll-container');
    await act(async () => {
      scrollElement.scrollTop = 200;
      scrollElement.dispatchEvent(new Event('scroll'));
    });

    await waitFor(() => {
      expect(mockGetRows).toHaveBeenCalled();
    });
  });

  it('handles document view export', async () => {
    const user = userEvent.setup();
    mockGetColumns.mockResolvedValue(buildColumnsResponse(emailColumns));
    mockGetRows.mockResolvedValue(
      buildRowsResponse({ rows: singleNameRow, totalCount: 1 })
    );

    await renderAndWait();

    await user.click(screen.getByTitle('Document view'));
    await user.click(screen.getByTitle('Export as CSV'));

    await waitFor(() => {
      expect(mockGetRows).toHaveBeenCalled();
    });
  });
});
