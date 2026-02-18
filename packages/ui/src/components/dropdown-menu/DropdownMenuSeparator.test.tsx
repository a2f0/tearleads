import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DropdownMenuSeparator } from './DropdownMenuSeparator';

describe('DropdownMenuSeparator', () => {
  it('renders an hr with separator classes', () => {
    render(<DropdownMenuSeparator />);

    const separator = screen.getByRole('separator');
    expect(separator).toHaveClass('my-1', 'border-border');
  });
});
