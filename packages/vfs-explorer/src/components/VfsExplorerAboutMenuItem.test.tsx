import { ThemeProvider } from '@tearleads/ui';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { VfsExplorerAboutMenuItem } from './VfsExplorerAboutMenuItem';

vi.mock('@tearleads/vfs-explorer/package.json', () => ({
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

describe('VfsExplorerAboutMenuItem', () => {
  it('renders with correct app name and version', () => {
    render(
      <ThemeProvider>
        <VfsExplorerAboutMenuItem />
      </ThemeProvider>
    );

    const [aboutButton] = screen.getAllByRole('menuitem', { name: 'About' });
    fireEvent.click(aboutButton);

    expect(screen.getByText('About VFS Explorer')).toBeInTheDocument();
    expect(screen.getByTestId('about-version')).toHaveTextContent('0.0.8');
  });
});
