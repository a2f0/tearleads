/**
 * Test to verify MlsChatWindow context integration.
 * This test does NOT mock @rapid/mls-chat to verify the real context behavior.
 *
 * Regression test for: "Cannot read properties of null (reading 'useContext')"
 * Root cause: React version mismatch between client (19.2.4) and mls-chat (19.2.3)
 * and missing vitest alias for @rapid/mls-chat source files.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// Mock dependencies EXCEPT @rapid/mls-chat to test real context integration
vi.mock('@/components/floating-window', () => ({
  FloatingWindow: ({
    children,
    title
  }: {
    children: React.ReactNode;
    title: string;
  }) => (
    <div data-testid="floating-window" data-title={title}>
      {children}
    </div>
  )
}));

vi.mock('@/components/sqlite/InlineUnlock', () => ({
  InlineUnlock: () => <div data-testid="inline-unlock" />
}));

vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => ({
    isUnlocked: true,
    isLoading: false
  })
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    token: 'test-token',
    user: { id: 'user-1', email: 'test@example.com' }
  })
}));

vi.mock('@/i18n', () => ({
  useTypedTranslation: () => ({
    t: (key: string) => key
  })
}));

// Import AFTER mocks are set up
import { MlsChatWindow } from './MlsChatWindow';

describe('MlsChatWindow context integration', () => {
  const defaultProps = {
    id: 'test-window',
    onClose: vi.fn(),
    onMinimize: vi.fn(),
    onFocus: vi.fn(),
    zIndex: 100
  };

  it('renders MlsChatProvider and children without context errors', async () => {
    // Suppress expected async warnings from MlsClient initialization
    // The key assertion is that the component renders without the useContext error
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // This test verifies that the MlsChatProvider from @rapid/mls-chat
    // correctly provides context to child hooks (useMlsClient, etc.)
    // Before the fix, this threw: "Cannot read properties of null (reading 'useContext')"
    // due to React version mismatch and missing vitest alias
    render(<MlsChatWindow {...defaultProps} />);

    // Verify the window rendered - this proves no useContext error occurred
    expect(screen.getByTestId('floating-window')).toBeInTheDocument();

    // Wait for the MlsChatWindowInner to render (shows MLS Chat Setup)
    await waitFor(() => {
      expect(screen.getByText('MLS Chat Setup')).toBeInTheDocument();
    });

    consoleSpy.mockRestore();
  });
});
