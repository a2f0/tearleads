import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WindowSidebarLoading } from './WindowSidebarLoading.js';

describe('WindowSidebarLoading', () => {
  it('renders loading spinner container', () => {
    const { container } = render(<WindowSidebarLoading />);

    expect(container.firstChild).toHaveClass('justify-center', 'py-4');
    expect(container.querySelector('svg')).toBeInTheDocument();
  });
});
