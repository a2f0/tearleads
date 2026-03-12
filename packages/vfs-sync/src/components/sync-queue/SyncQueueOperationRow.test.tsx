import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SyncQueueOperationRow } from './SyncQueueOperationRow';

describe('SyncQueueOperationRow', () => {
  it('renders kind badge and truncated id', () => {
    render(<SyncQueueOperationRow kind="create" id="abcdef1234567890" />);
    expect(screen.getByText('create')).toBeInTheDocument();
    expect(screen.getByText('abcdef12...')).toBeInTheDocument();
  });

  it('renders short ids without truncation', () => {
    render(<SyncQueueOperationRow kind="stage" id="abc" />);
    expect(screen.getByText('abc')).toBeInTheDocument();
  });

  it('renders detail when provided', () => {
    render(
      <SyncQueueOperationRow kind="update" id="op-1" detail="item:12345678" />
    );
    expect(screen.getByText('item:12345678')).toBeInTheDocument();
  });

  it('renders timestamp when provided', () => {
    render(
      <SyncQueueOperationRow
        kind="delete"
        id="op-2"
        timestamp="2024-01-15T10:00:00Z"
      />
    );
    expect(screen.getByText('2024-01-15T10:00:00Z')).toBeInTheDocument();
  });

  it('does not render detail or timestamp when omitted', () => {
    const { container } = render(
      <SyncQueueOperationRow kind="create" id="op-3" />
    );
    const spans = container.querySelectorAll('span');
    expect(spans.length).toBe(2);
  });
});
