import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HelpWindow } from './HelpWindow';

const mockUseWindowOpenRequest = vi.fn();
let mockFetch: ReturnType<typeof vi.fn>;

vi.mock('@/contexts/WindowManagerContext', () => ({
  useWindowOpenRequest: (...args: unknown[]) =>
    mockUseWindowOpenRequest(...args)
}));

vi.mock('@tearleads/ui', async () => {
  const actual =
    await vi.importActual<typeof import('@tearleads/ui')>('@tearleads/ui');
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
      <button type="button" onClick={onClick}>
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
      <div>
        <div data-testid="window-title">{title}</div>
        {children}
      </div>
    )
  };
});

vi.mock('@/components/help-links/HelpDocumentation', () => ({
  HelpDocumentation: ({ docId }: { docId: string }) => (
    <div data-testid="help-documentation">{docId}</div>
  )
}));

function renderHelpWindow() {
  return render(
    <HelpWindow
      id="help-1"
      onClose={vi.fn()}
      onMinimize={vi.fn()}
      onFocus={vi.fn()}
      zIndex={1}
    />
  );
}

describe('HelpWindow', () => {
  beforeEach(() => {
    mockFetch = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders index view by default', () => {
    mockUseWindowOpenRequest.mockReturnValue(undefined);
    renderHelpWindow();
    expect(screen.getByTestId('window-title')).toHaveTextContent('Help');
    expect(screen.getByText('Developer')).toBeInTheDocument();
  });

  it('navigates to API docs and back', async () => {
    const user = userEvent.setup();
    mockUseWindowOpenRequest.mockReturnValue(undefined);
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        openapi: '3.0.0',
        info: { title: 'Client Docs' },
        paths: {}
      })
    });
    renderHelpWindow();

    await user.click(screen.getByText('API Docs'));
    expect(screen.getByTestId('window-title')).toHaveTextContent('API Docs');
    expect(await screen.findByTestId('api-docs')).toBeInTheDocument();

    await user.click(screen.getByTestId('help-window-control-back'));
    expect(screen.getByTestId('window-title')).toHaveTextContent('Help');
  });

  it('opens requested help doc from window open request', () => {
    mockUseWindowOpenRequest.mockReturnValue({
      helpDocId: 'cli',
      requestId: 1
    });
    renderHelpWindow();
    expect(screen.getByTestId('window-title')).toHaveTextContent('CLI');
    expect(screen.getByTestId('help-documentation')).toHaveTextContent('cli');
  });

  it('navigates through developer and legal documentation views', async () => {
    const user = userEvent.setup();
    mockUseWindowOpenRequest.mockReturnValue(undefined);
    renderHelpWindow();

    await user.click(screen.getByText('Developer'));
    expect(screen.getByTestId('window-title')).toHaveTextContent('Developer');
    await user.click(screen.getByText('CLI Reference'));
    expect(screen.getByTestId('window-title')).toHaveTextContent(
      'CLI Reference'
    );
    expect(screen.getByTestId('help-documentation')).toHaveTextContent(
      'cliReference'
    );

    await user.click(screen.getByTestId('help-window-control-back'));
    await user.click(screen.getByText('Legal'));
    expect(screen.getByTestId('window-title')).toHaveTextContent('Legal');
    await user.click(screen.getByText('Terms of Service'));
    expect(screen.getByTestId('window-title')).toHaveTextContent(
      'Terms of Service'
    );
    expect(screen.getByTestId('help-documentation')).toHaveTextContent(
      'termsOfService'
    );
  });
});
