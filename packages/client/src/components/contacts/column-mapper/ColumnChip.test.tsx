import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ColumnChip } from './ColumnChip';

describe('ColumnChip', () => {
  it('renders the header and drag icon', () => {
    const { container } = render(<ColumnChip header="Email" />);

    expect(screen.getByText('Email')).toBeInTheDocument();
    expect(container.querySelector('svg')).toBeInTheDocument();
  });
});
