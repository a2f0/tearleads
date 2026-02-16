import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StickyVirtualListStatus } from './StickyVirtualListStatus';

describe('StickyVirtualListStatus', () => {
  it('renders status correctly', () => {
    render(
      <StickyVirtualListStatus
        firstVisible={0}
        lastVisible={10}
        loadedCount={20}
        totalCount={100}
        hasMore={true}
      />
    );

    expect(screen.getByText(/viewing 1-11/i)).toBeInTheDocument();
    expect(screen.getByText(/100 total/i)).toBeInTheDocument();
  });
});
