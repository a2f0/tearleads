import { render, screen } from '@testing-library/react';
import { AlertTriangle } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { WindowPaneState } from './WindowPaneState.js';

describe('WindowPaneState', () => {
  it('renders title and description', () => {
    render(
      <WindowPaneState title="No items" description="Create your first item" />
    );

    expect(screen.getByText('No items')).toBeInTheDocument();
    expect(screen.getByText('Create your first item')).toBeInTheDocument();
  });

  it('supports inline layout with icon', () => {
    const { container } = render(
      <WindowPaneState
        layout="inline"
        icon={<AlertTriangle data-testid="state-icon" />}
        title="Loading"
      />
    );

    expect(screen.getByTestId('state-icon')).toBeInTheDocument();
    expect(container.firstChild).toHaveClass('flex', 'items-center', 'p-4');
  });

  it('applies error tone styles', () => {
    const { container } = render(
      <WindowPaneState tone="error" title="Failed" description="Try again" />
    );

    expect(container.firstChild).toHaveClass(
      'border-destructive',
      'bg-destructive/10',
      'text-destructive'
    );
  });

  it('renders action slot', () => {
    render(
      <WindowPaneState
        title="Empty state"
        action={
          <button type="button" data-testid="action-button">
            Create
          </button>
        }
      />
    );

    expect(screen.getByTestId('action-button')).toBeInTheDocument();
    expect(screen.getByText('Create')).toBeInTheDocument();
  });
});
