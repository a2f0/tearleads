import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HelpWindow } from './HelpWindow';

vi.mock('@tearleads/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tearleads/ui')>();
  return {
    ...actual,
    ApiDocs: ({ spec }: { spec: { info: { title: string } } }) => (
      <div data-testid="api-docs">{spec.info.title}</div>
    ),
    IconSquare: ({
      label,
      onClick
    }: {
      label: string;
      onClick?: () => void;
    }) => (
      <button type="button" onClick={onClick} data-testid="icon-square">
        {label}
      </button>
    )
  };
});

vi.mock('@tearleads/window-manager', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@tearleads/window-manager')>();
  return {
    ...actual,
    DesktopFloatingWindow: ({
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
  };
});

vi.mock('../help-links/HelpDocumentation', () => ({
  HelpDocumentation: ({ docId }: { docId: string }) => (
    <div data-testid="help-documentation">{docId}</div>
  )
}));

describe('HelpWindow', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
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
        })
      }))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const docCases = [
    { label: 'CLI Reference', title: 'CLI Reference', docId: 'cliReference' },
    { label: 'CI', title: 'CI', docId: 'ci' },
    {
      label: 'Chrome Extension',
      title: 'Chrome Extension',
      docId: 'chromeExtension'
    },
    {
      label: 'Backup & Restore',
      title: 'Backup & Restore',
      docId: 'backupRestore'
    },
    {
      label: 'VFS',
      title: 'VFS',
      docId: 'vfs'
    },
    {
      label: 'Tuxedo',
      title: 'Tuxedo',
      docId: 'tuxedo'
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
    expect(screen.getByText('Developer')).toBeInTheDocument();
    expect(screen.getByText('Legal')).toBeInTheDocument();
    expect(
      screen.queryByTestId('help-window-control-back')
    ).not.toBeInTheDocument();
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
    expect(await screen.findByTestId('api-docs')).toHaveTextContent(
      'Client Docs'
    );
    expect(screen.getByTestId('help-window-control-back')).toBeInTheDocument();
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
    expect(screen.getByTestId('help-window-control-back')).toBeInTheDocument();

    // Navigate back to index from the control bar
    await user.click(screen.getByTestId('help-window-control-back'));

    expect(screen.getByTestId('window-title')).toHaveTextContent('Help');
    expect(screen.queryByTestId('api-docs')).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('help-window-control-back')
    ).not.toBeInTheDocument();
  });

  it('navigates to documentation views when clicking docs links', async () => {
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

    for (const { label, title, docId } of docCases) {
      await user.click(screen.getByText('Developer'));
      await user.click(screen.getByText(label));
      expect(screen.getByTestId('window-title')).toHaveTextContent(title);
      expect(screen.getByTestId('help-documentation')).toHaveTextContent(docId);
      await user.click(screen.getByTestId('help-window-control-back'));
    }
  });

  it('navigates to developer category and back to help', async () => {
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

    await user.click(screen.getByText('Developer'));
    expect(screen.getByTestId('window-title')).toHaveTextContent('Developer');
    expect(screen.getByText('CI')).toBeInTheDocument();

    await user.click(screen.getByTestId('help-window-control-back'));
    expect(screen.getByTestId('window-title')).toHaveTextContent('Help');
  });

  it('navigates to legal category and back to help', async () => {
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

    await user.click(screen.getByText('Legal'));
    expect(screen.getByTestId('window-title')).toHaveTextContent('Legal');
    expect(screen.getByText('Privacy Policy')).toBeInTheDocument();
    expect(screen.getByText('Terms of Service')).toBeInTheDocument();

    await user.click(screen.getByTestId('help-window-control-back'));
    expect(screen.getByTestId('window-title')).toHaveTextContent('Help');
  });

  const legalDocCases = [
    {
      label: 'Privacy Policy',
      title: 'Privacy Policy',
      docId: 'privacyPolicy'
    },
    {
      label: 'Terms of Service',
      title: 'Terms of Service',
      docId: 'termsOfService'
    }
  ] as const;

  it('navigates to legal documentation views when clicking legal docs links', async () => {
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

    for (const { label, title, docId } of legalDocCases) {
      await user.click(screen.getByText('Legal'));
      await user.click(screen.getByText(label));
      expect(screen.getByTestId('window-title')).toHaveTextContent(title);
      expect(screen.getByTestId('help-documentation')).toHaveTextContent(docId);
      await user.click(screen.getByTestId('help-window-control-back'));
    }
  });

  it('navigates to specific doc when openHelpDocId is provided', () => {
    render(
      <HelpWindow
        id="help-1"
        onClose={vi.fn()}
        onMinimize={vi.fn()}
        onFocus={vi.fn()}
        zIndex={1}
        openHelpDocId="cli"
        openRequestId={1}
      />
    );

    expect(screen.getByTestId('window-title')).toHaveTextContent('CLI');
    expect(screen.getByTestId('help-documentation')).toHaveTextContent('cli');
    expect(screen.getByTestId('help-window-control-back')).toBeInTheDocument();
  });

  it('does not navigate when openHelpDocId is provided but openRequestId is missing', () => {
    render(
      <HelpWindow
        id="help-1"
        onClose={vi.fn()}
        onMinimize={vi.fn()}
        onFocus={vi.fn()}
        zIndex={1}
        openHelpDocId="cli"
      />
    );

    expect(screen.getByTestId('window-title')).toHaveTextContent('Help');
    expect(screen.queryByTestId('help-documentation')).not.toBeInTheDocument();
  });

  it('navigates when openRequestId changes with same openHelpDocId', () => {
    const { rerender } = render(
      <HelpWindow
        id="help-1"
        onClose={vi.fn()}
        onMinimize={vi.fn()}
        onFocus={vi.fn()}
        zIndex={1}
        openHelpDocId="cli"
        openRequestId={1}
      />
    );

    expect(screen.getByTestId('help-documentation')).toHaveTextContent('cli');

    rerender(
      <HelpWindow
        id="help-1"
        onClose={vi.fn()}
        onMinimize={vi.fn()}
        onFocus={vi.fn()}
        zIndex={1}
        openHelpDocId="vfs"
        openRequestId={2}
      />
    );

    expect(screen.getByTestId('window-title')).toHaveTextContent('VFS');
    expect(screen.getByTestId('help-documentation')).toHaveTextContent('vfs');
  });
});
