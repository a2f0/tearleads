import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { VfsStatusBar } from './VfsStatusBar';

describe('VfsStatusBar', () => {
  it('shows transient message when provided', () => {
    render(
      <VfsStatusBar
        itemCount={5}
        message={{ text: '2 items linked', type: 'info' }}
      />
    );

    expect(screen.getByText('2 items linked')).toBeInTheDocument();
  });

  it('shows selected item count for multi-select', () => {
    render(<VfsStatusBar itemCount={5} selectedItemCount={3} />);
    expect(screen.getByText('3 items selected')).toBeInTheDocument();
  });

  it('shows selected item name for single selection', () => {
    render(
      <VfsStatusBar
        itemCount={5}
        selectedItemCount={1}
        selectedItemName="document.pdf"
      />
    );
    expect(screen.getByText('document.pdf')).toBeInTheDocument();
  });
});
