import { fireEvent, render, screen } from '@testing-library/react';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi
} from 'vitest';
import { WindowSidebar } from './WindowSidebar';

vi.mock('../../hooks/useIsMobile.js', () => ({
  useIsMobile: vi.fn(() => false)
}));

import { useIsMobile } from '../../hooks/useIsMobile.js';

const mockUseIsMobile = useIsMobile as Mock;

describe('WindowSidebar', () => {
  const defaultProps = {
    width: 200,
    onWidthChange: vi.fn(),
    ariaLabel: 'Test sidebar',
    open: true,
    onOpenChange: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseIsMobile.mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('desktop mode', () => {
    it('renders inline with specified width', () => {
      render(
        <WindowSidebar {...defaultProps}>
          <div>Content</div>
        </WindowSidebar>
      );
      const sidebar = screen.getByTestId('window-sidebar');
      expect(sidebar).toBeInTheDocument();
      expect(sidebar.style.width).toBe('200px');
    });

    it('renders children', () => {
      render(
        <WindowSidebar {...defaultProps}>
          <div>Sidebar content</div>
        </WindowSidebar>
      );
      expect(screen.getByText('Sidebar content')).toBeInTheDocument();
    });

    it('renders resize handle', () => {
      render(
        <WindowSidebar {...defaultProps}>
          <div>Content</div>
        </WindowSidebar>
      );
      expect(screen.getByRole('separator')).toBeInTheDocument();
    });

    it('uses custom data-testid', () => {
      render(
        <WindowSidebar {...defaultProps} data-testid="custom-sidebar">
          <div>Content</div>
        </WindowSidebar>
      );
      expect(screen.getByTestId('custom-sidebar')).toBeInTheDocument();
    });
  });

  describe('mobile drawer mode', () => {
    beforeEach(() => {
      mockUseIsMobile.mockReturnValue(true);
    });

    it('renders nothing when closed', () => {
      render(
        <WindowSidebar {...defaultProps} open={false}>
          <div>Content</div>
        </WindowSidebar>
      );
      expect(screen.queryByTestId('window-sidebar')).not.toBeInTheDocument();
    });

    it('renders drawer when open', () => {
      render(
        <WindowSidebar {...defaultProps}>
          <div>Drawer content</div>
        </WindowSidebar>
      );
      expect(screen.getByTestId('window-sidebar')).toBeInTheDocument();
      expect(screen.getByText('Drawer content')).toBeInTheDocument();
    });

    it('renders backdrop', () => {
      render(
        <WindowSidebar {...defaultProps}>
          <div>Content</div>
        </WindowSidebar>
      );
      expect(screen.getByTestId('window-sidebar-backdrop')).toBeInTheDocument();
    });

    it('closes on backdrop click', () => {
      render(
        <WindowSidebar {...defaultProps}>
          <div>Content</div>
        </WindowSidebar>
      );
      fireEvent.click(screen.getByTestId('window-sidebar-backdrop'));
      expect(defaultProps.onOpenChange).toHaveBeenCalledWith(false);
    });

    it('closes on Escape key', () => {
      render(
        <WindowSidebar {...defaultProps}>
          <div>Content</div>
        </WindowSidebar>
      );
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(defaultProps.onOpenChange).toHaveBeenCalledWith(false);
    });

    it('has dialog role with aria-label', () => {
      render(
        <WindowSidebar {...defaultProps}>
          <div>Content</div>
        </WindowSidebar>
      );
      const drawer = screen.getByRole('dialog');
      expect(drawer).toHaveAttribute('aria-label', 'Test sidebar');
      expect(drawer).toHaveAttribute('aria-modal', 'true');
    });

    it('does not render resize handle', () => {
      render(
        <WindowSidebar {...defaultProps}>
          <div>Content</div>
        </WindowSidebar>
      );
      expect(screen.queryByRole('separator')).not.toBeInTheDocument();
    });
  });
});
