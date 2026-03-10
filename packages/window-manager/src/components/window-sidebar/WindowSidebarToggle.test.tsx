import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi
} from 'vitest';
import { WindowSidebarToggle } from './WindowSidebarToggle';

vi.mock('../../hooks/useIsMobile.js', () => ({
  useIsMobile: vi.fn(() => false)
}));

import { useIsMobile } from '../../hooks/useIsMobile.js';

const mockUseIsMobile = useIsMobile as Mock;

describe('WindowSidebarToggle', () => {
  const onToggle = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseIsMobile.mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null on desktop', () => {
    const { container } = render(<WindowSidebarToggle onToggle={onToggle} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders button on mobile', () => {
    mockUseIsMobile.mockReturnValue(true);
    render(<WindowSidebarToggle onToggle={onToggle} />);
    expect(screen.getByTestId('window-sidebar-toggle')).toBeInTheDocument();
  });

  it('calls onToggle when clicked', async () => {
    mockUseIsMobile.mockReturnValue(true);
    const user = userEvent.setup();
    render(<WindowSidebarToggle onToggle={onToggle} />);
    await user.click(screen.getByTestId('window-sidebar-toggle'));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('has accessible label', () => {
    mockUseIsMobile.mockReturnValue(true);
    render(<WindowSidebarToggle onToggle={onToggle} />);
    expect(screen.getByLabelText('Toggle sidebar')).toBeInTheDocument();
  });
});
