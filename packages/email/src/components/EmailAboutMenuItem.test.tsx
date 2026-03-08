import { ThemeProvider } from '@tearleads/ui';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { EmailAboutMenuItem } from './EmailAboutMenuItem';

vi.mock('@tearleads/email/package.json', () => ({
  default: { version: '0.0.8' }
}));

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  });
});

describe('EmailAboutMenuItem', () => {
  it('renders with correct app name and version', () => {
    render(
      <ThemeProvider>
        <EmailAboutMenuItem />
      </ThemeProvider>
    );

    const aboutButton = screen.getAllByRole('menuitem', { name: 'About' })[0];
    if (aboutButton) fireEvent.click(aboutButton);

    expect(screen.getByText('About Email')).toBeInTheDocument();
    expect(screen.getByTestId('about-version')).toHaveTextContent('0.0.8');
  });
});
