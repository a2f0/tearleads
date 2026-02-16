import type { Virtualizer } from '@tanstack/react-virtual';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TableView } from './TableView';

describe('TableView', () => {
  const mockVirtualizer: Pick<
    Virtualizer<HTMLDivElement, Element>,
    'getVirtualItems' | 'getTotalSize' | 'measureElement'
  > = {
    getVirtualItems: () => [],
    getTotalSize: () => 0,
    measureElement: vi.fn()
  };

  it('renders correctly', () => {
    render(
      <TableView
        parentRef={{ current: null }}
        virtualizer={mockVirtualizer}
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
