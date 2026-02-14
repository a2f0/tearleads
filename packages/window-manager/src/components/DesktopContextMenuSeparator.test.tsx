import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DesktopContextMenuSeparator } from './DesktopContextMenuSeparator.js';

describe('DesktopContextMenuSeparator', () => {
  it('renders a separator with desktop context menu styles', () => {
    render(<DesktopContextMenuSeparator />);

    const separator = screen.getByRole('separator');
    expect(separator).toHaveClass('my-1 h-px border-0 bg-border');
  });
});
