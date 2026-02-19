import { vi } from 'vitest';

const defaultColumns = [
  { name: 'id', type: 'integer', nullable: false, ordinalPosition: 1 },
  { name: 'name', type: 'text', nullable: true, ordinalPosition: 2 }
];

const defaultRowsResponse = {
  rows: [],
  totalCount: 0,
  limit: 50,
  offset: 0
};

type ColumnsResponse = { columns: typeof defaultColumns };

type RowsResponse = {
  rows: Record<string, unknown>[];
  totalCount: number;
  limit: number;
  offset: number;
};

const buildColumnsResponse = (
  columns: ColumnsResponse['columns'] = defaultColumns
): ColumnsResponse => ({
  columns
});

const buildRowsResponse = (
  response: Partial<RowsResponse> = {}
): RowsResponse => ({
  ...defaultRowsResponse,
  ...response
});

const createMockApi = () => {
  const mockGetColumns = vi.fn();
  const mockGetRows = vi.fn();

  return { mockGetColumns, mockGetRows };
};

export { buildColumnsResponse, buildRowsResponse, createMockApi };
