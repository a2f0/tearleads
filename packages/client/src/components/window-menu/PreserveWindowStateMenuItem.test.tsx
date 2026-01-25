import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PreserveWindowStateMenuItem } from './PreserveWindowStateMenuItem';

const mockSetPreserveWindowState = vi.fn();

vi.mock('@/hooks/usePreserveWindowState', () => ({
  usePreserveWindowState: () => ({
    preserveWindowState: true,
    setPreserveWindowState: mockSetPreserveWindowState
  })
}));

describe('PreserveWindowStateMenuItem', () => {
  it('toggles preserve window state when clicked', async () => {
    const user = userEvent.setup();
    render(<PreserveWindowStateMenuItem />);

    await user.click(screen.getByText('Preserve Window State'));

    expect(mockSetPreserveWindowState).toHaveBeenCalledWith(false);
  });
});
