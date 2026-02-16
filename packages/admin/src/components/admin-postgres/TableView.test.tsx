import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TableView } from './TableView';

describe('TableView', () => {
  const mockVirtualizer = {
    getVirtualItems: () => [],
    getTotalSize: () => 0,
    measureElement: vi.fn()
  };

  it('renders correctly', () => {
    render(
      <TableView
        parentRef={{ current: null }}
        virtualizer={mockVirtualizer as any}
        rows={[]}
        visibleColumns={[]}
        sort={{ column: null, direction: null }}
        handleSort={() => {}}
        loadingMore={false}
        stickyStatus={<div>Status</div>}
      />
    );

    expect(screen.getByText('Status')).toBeInTheDocument();
  });
});
