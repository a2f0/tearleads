import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from './themeProvider';
import { ThemeProviderTestConsumer } from './themeProviderTestConsumer';

describe('ThemeProviderTestConsumer', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: false,
        media: '(prefers-color-scheme: dark)',
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn()
      }))
    });
  });

  it('exposes controls for all supported theme values', async () => {
    const user = userEvent.setup();

    render(
      <ThemeProvider defaultTheme="light">
        <ThemeProviderTestConsumer />
      </ThemeProvider>
    );

    await user.click(screen.getByText('Set Tokyo Night'));
    expect(screen.getByTestId('theme')).toHaveTextContent('tokyo-night');

    await user.click(screen.getByText('Set Monochrome'));
    expect(screen.getByTestId('theme')).toHaveTextContent('monochrome');

    await user.click(screen.getByText('Set System'));
    expect(screen.getByTestId('theme')).toHaveTextContent('system');
  });
});
