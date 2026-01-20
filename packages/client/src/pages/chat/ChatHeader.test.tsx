import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ChatHeader } from './ChatHeader';

vi.mock('@/components/ModelSelector', () => ({
  ModelSelector: ({
    modelDisplayName
  }: {
    modelDisplayName?: string | undefined;
  }) => <div data-testid="model-selector">{modelDisplayName ?? 'none'}</div>
}));

describe('ChatHeader', () => {
  it('shows back link by default', () => {
    render(
      <MemoryRouter>
        <ChatHeader modelDisplayName="Test Model" />
      </MemoryRouter>
    );

    expect(screen.getByTestId('back-link')).toBeInTheDocument();
  });

  it('renders the model selector display name', () => {
    render(
      <MemoryRouter>
        <ChatHeader modelDisplayName="Test Model" />
      </MemoryRouter>
    );

    expect(screen.getByTestId('model-selector')).toHaveTextContent(
      'Test Model'
    );
  });
});
