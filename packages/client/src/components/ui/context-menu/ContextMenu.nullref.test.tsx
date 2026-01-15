import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useRef: () => ({ current: null })
  };
});

import { ContextMenu } from './ContextMenu';

describe('ContextMenu with missing ref', () => {
  it('renders without adjusting position when ref is null', () => {
    render(
      <ContextMenu x={50} y={75} onClose={() => {}}>
        <div>Menu content</div>
      </ContextMenu>
    );

    expect(screen.getByText('Menu content')).toBeInTheDocument();
  });
});
