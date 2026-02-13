import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { HelpWindow } from './HelpWindow';

vi.mock('@tearleads/api/dist/openapi.json', () => ({
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

vi.mock('@tearleads/ui', () => ({
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

vi.mock('../help-links/HelpDocumentation', () => ({
  HelpDocumentation: ({ docId }: { docId: string }) => (
    <div data-testid="help-documentation">{docId}</div>
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
      await user.click(screen.getByText('Back to Help'));
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

    await user.click(screen.getByText('Back to Help'));
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

    await user.click(screen.getByText('Back to Help'));
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
      await user.click(screen.getByText('Back to Help'));
    }
  });
});
