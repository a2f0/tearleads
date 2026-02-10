import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { HELP_EXTERNAL_LINKS } from '@/constants/help';
import { HelpWindow } from './HelpWindow';

vi.mock('@rapid/api/dist/openapi.json', () => ({
  default: {
    openapi: '3.0.0',
    info: {
      title: 'Client Docs',
      version: '0.1.0',
      description: 'Client docs overview.'
    },
    paths: {
      '/ping': {
        get: {
          summary: 'Ping',
          responses: {
            '200': {
              description: 'ok'
            }
          }
        }
      }
    }
  }
}));

vi.mock('@rapid/ui', () => ({
  ApiDocs: ({ spec }: { spec: { info: { title: string } } }) => (
    <div data-testid="api-docs">{spec.info.title}</div>
  )
}));

vi.mock('@/components/floating-window', () => ({
  FloatingWindow: ({
    children,
    title
  }: {
    children: React.ReactNode;
    title: string;
  }) => (
    <div data-testid="floating-window">
      <div data-testid="window-title">{title}</div>
      {children}
    </div>
  )
}));

vi.mock('@/components/ui/grid-square', () => ({
  GridSquare: ({
    children,
    onClick
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick} data-testid="grid-square">
      {children}
    </button>
  )
}));

describe('HelpWindow', () => {
  const externalLinkCases = [
    { label: 'CLI', href: HELP_EXTERNAL_LINKS.cli },
    {
      label: 'Chrome Extension',
      href: HELP_EXTERNAL_LINKS.chromeExtension
    },
    {
      label: 'Backup & Restore',
      href: HELP_EXTERNAL_LINKS.backupRestore
    }
  ] as const;

  it('renders the help index view initially', () => {
    render(
      <HelpWindow
        id="help-1"
        onClose={vi.fn()}
        onMinimize={vi.fn()}
        onFocus={vi.fn()}
        zIndex={1}
      />
    );

    expect(screen.getByTestId('window-title')).toHaveTextContent('Help');
    expect(screen.getByText('API Docs')).toBeInTheDocument();
    expect(screen.getByText('CLI')).toBeInTheDocument();
    expect(screen.getByText('Chrome Extension')).toBeInTheDocument();
    expect(screen.getByText('Backup & Restore')).toBeInTheDocument();
  });

  it('navigates to API docs when clicking API Docs', async () => {
    const user = userEvent.setup();
    render(
      <HelpWindow
        id="help-1"
        onClose={vi.fn()}
        onMinimize={vi.fn()}
        onFocus={vi.fn()}
        zIndex={1}
      />
    );

    await user.click(screen.getByText('API Docs'));

    expect(screen.getByTestId('window-title')).toHaveTextContent('API Docs');
    expect(screen.getByTestId('api-docs')).toHaveTextContent('Client Docs');
  });

  it('navigates back to index from API docs view', async () => {
    const user = userEvent.setup();
    render(
      <HelpWindow
        id="help-1"
        onClose={vi.fn()}
        onMinimize={vi.fn()}
        onFocus={vi.fn()}
        zIndex={1}
      />
    );

    // Navigate to API docs
    await user.click(screen.getByText('API Docs'));
    expect(screen.getByTestId('window-title')).toHaveTextContent('API Docs');

    // Navigate back to index
    await user.click(screen.getByText('Back to Help'));

    expect(screen.getByTestId('window-title')).toHaveTextContent('Help');
    expect(screen.queryByTestId('api-docs')).not.toBeInTheDocument();
  });

  it('opens external docs links in a new tab', async () => {
    const user = userEvent.setup();
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    render(
      <HelpWindow
        id="help-1"
        onClose={vi.fn()}
        onMinimize={vi.fn()}
        onFocus={vi.fn()}
        zIndex={1}
      />
    );

    for (const { label, href } of externalLinkCases) {
      await user.click(screen.getByText(label));
      expect(openSpy).toHaveBeenLastCalledWith(href, '_blank', 'noopener');
    }

    expect(openSpy).toHaveBeenCalledTimes(externalLinkCases.length);

    openSpy.mockRestore();
  });
});
