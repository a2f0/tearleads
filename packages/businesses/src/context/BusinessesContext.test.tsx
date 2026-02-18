import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  BusinessesProvider,
  type BusinessesUIComponents,
  useBusinesses
} from './BusinessesContext.js';

const uiComponents: BusinessesUIComponents = {
  DropdownMenu: ({ trigger, children }) => (
    <div>
      <span>{trigger}</span>
      {children}
    </div>
  ),
  DropdownMenuItem: ({ children, onClick }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  AboutMenuItem: ({ appName, closeLabel }) => (
    <span>
      {appName}:{closeLabel}
    </span>
  )
};

function ContextConsumer() {
  const { ui } = useBusinesses();
  return <span>{ui === uiComponents ? 'has-ui' : 'missing-ui'}</span>;
}

describe('BusinessesContext', () => {
  it('provides ui components through BusinessesProvider', () => {
    render(
      <BusinessesProvider ui={uiComponents}>
        <ContextConsumer />
      </BusinessesProvider>
    );

    expect(screen.getByText('has-ui')).toBeInTheDocument();
  });

  it('throws when useBusinesses is used outside the provider', () => {
    expect(() => render(<ContextConsumer />)).toThrow(
      'Businesses context is not available. Ensure BusinessesProvider is configured.'
    );
  });
});
