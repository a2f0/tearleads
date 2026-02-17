import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PostgresTableRowsView } from './PostgresTableRowsView';
import {
  defaultSchema,
  defaultTableName,
  jsonColumns,
  jsonRow,
  nameColumns,
  nameRows
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

describe('PostgresTableRowsView (rendering)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetColumns.mockResolvedValue(buildColumnsResponse(jsonColumns));
    mockGetRows.mockResolvedValue(
      buildRowsResponse({ rows: jsonRow, totalCount: 1 })
    );
  });

  it('renders rows with json data', async () => {
    await renderAndWait();

    expect(screen.getByText(/\{"a":1\}/)).toBeInTheDocument();
  });

  it('renders multiple rows', async () => {
    mockGetColumns.mockResolvedValue(buildColumnsResponse(nameColumns));
    mockGetRows.mockResolvedValue(
      buildRowsResponse({ rows: nameRows, totalCount: 2 })
    );
    await renderAndWait();

    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('renders placeholder for null data', async () => {
    mockGetColumns.mockResolvedValue(buildColumnsResponse(jsonColumns));
    mockGetRows.mockResolvedValue(
      buildRowsResponse({ rows: [{ json: null }], totalCount: 1 })
    );

    await renderAndWait();

    expect(screen.getByText('NULL')).toBeInTheDocument();
  });

  it('renders row count in status', async () => {
    mockGetColumns.mockResolvedValue(buildColumnsResponse(nameColumns));
    mockGetRows.mockResolvedValue(
      buildRowsResponse({ rows: nameRows, totalCount: 2 })
    );

    await renderAndWait();

    expect(screen.getByText(/Viewing/)).toBeInTheDocument();
  });
});
