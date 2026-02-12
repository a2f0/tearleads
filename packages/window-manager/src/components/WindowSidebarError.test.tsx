import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WindowSidebarError } from './WindowSidebarError.js';

describe('WindowSidebarError', () => {
  it('renders error message', () => {
    render(<WindowSidebarError message="Load failed" />);

    expect(screen.getByText('Load failed')).toBeInTheDocument();
  });
});
