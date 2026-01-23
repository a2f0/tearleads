import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
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
  });

  it('navigates to API docs when clicking the grid square', async () => {
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

    await user.click(screen.getByTestId('grid-square'));

    expect(screen.getByTestId('window-title')).toHaveTextContent('API Docs');
    expect(screen.getByTestId('api-docs')).toHaveTextContent('Client Docs');
  });
});
