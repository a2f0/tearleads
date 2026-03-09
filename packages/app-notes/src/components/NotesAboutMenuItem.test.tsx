import { ThemeProvider } from '@tearleads/ui';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { NotesAboutMenuItem } from './NotesAboutMenuItem';

vi.mock('@tearleads/app-notes/package.json', () => ({
  default: { version: '0.0.1' }
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

describe('NotesAboutMenuItem', () => {
  it('renders with correct app name and version', () => {
    render(
      <ThemeProvider>
        <NotesAboutMenuItem />
      </ThemeProvider>
    );

    const aboutButton = screen.getAllByRole('menuitem', { name: 'About' })[0];
    if (aboutButton) fireEvent.click(aboutButton);

    expect(screen.getByText('About Notes')).toBeInTheDocument();
    expect(screen.getByTestId('about-version')).toHaveTextContent('0.0.1');
  });
});
