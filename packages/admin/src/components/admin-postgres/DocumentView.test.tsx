import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DocumentView } from './DocumentView';

describe('DocumentView', () => {
  const mockVirtualizer = {
    getVirtualItems: () => [],
    getTotalSize: () => 0,
    measureElement: vi.fn()
  };

  it('renders correctly', () => {
    render(
      <DocumentView
        parentRef={{ current: null }}
        virtualizer={mockVirtualizer as any}
        rows={[]}
        loadingMore={false}
        stickyStatus={<div>Status</div>}
      />
    );

    expect(screen.getByText('Status')).toBeInTheDocument();
  });
});
