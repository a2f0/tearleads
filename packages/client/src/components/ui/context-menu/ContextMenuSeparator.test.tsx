import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ContextMenuSeparator } from './ContextMenuSeparator';

describe('ContextMenuSeparator', () => {
  it('renders a separator', () => {
    render(<ContextMenuSeparator />);

    expect(screen.getByRole('separator')).toBeInTheDocument();
  });
});
