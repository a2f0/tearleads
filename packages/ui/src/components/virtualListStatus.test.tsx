import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  getVirtualListStatusText,
  VirtualListStatus
} from './virtualListStatus.js';

describe('VirtualListStatus', () => {
  it('renders a viewing range when all items are loaded', () => {
    render(
      <VirtualListStatus
        firstVisible={0}
        lastVisible={4}
        loadedCount={5}
        itemLabel="item"
      />
    );

    expect(screen.getByText('Viewing 1-5 of 5 items')).toBeInTheDocument();
  });

  it('renders bigint totals without losing precision', () => {
    render(
      <VirtualListStatus
        firstVisible={0}
        lastVisible={49}
        loadedCount={50}
        totalCount={9007199254740993n}
        itemLabel="key"
      />
    );

    expect(
      screen.getByText('Viewing 1-50 (9,007,199,254,740,993 total)')
    ).toBeInTheDocument();
  });

  it('formats zero-result searches and paged totals', () => {
    expect(
      getVirtualListStatusText({
        firstVisible: null,
        lastVisible: null,
        loadedCount: 0,
        itemLabel: 'contact',
        searchQuery: 'alice'
      })
    ).toBe('0 contacts found');

    expect(
      getVirtualListStatusText({
        firstVisible: null,
        lastVisible: null,
        loadedCount: 50,
        totalCount: 1000,
        hasMore: true,
        itemLabel: 'key'
      })
    ).toBe('50 loaded+ of 1,000 total');
  });
});
