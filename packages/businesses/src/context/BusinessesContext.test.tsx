import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  type BusinessesDatabaseState,
  BusinessesProvider,
  type BusinessesUIComponents,
  useBusinesses,
  useBusinessesDatabaseState
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

function DefaultDatabaseStateConsumer() {
  const databaseState = useBusinessesDatabaseState();
  return (
    <span>
      {databaseState.currentInstanceId === null
        ? 'default-state'
        : 'unexpected-state'}
    </span>
  );
}

function ProvidedDatabaseStateConsumer() {
  const { databaseState } = useBusinesses();
  return (
    <span>
      {databaseState.currentInstanceId === 'instance-42'
        ? 'provided-state'
        : 'unexpected-state'}
    </span>
  );
}

const providedDatabaseState: BusinessesDatabaseState = {
  isUnlocked: false,
  isLoading: true,
  currentInstanceId: 'instance-42'
};

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

  it('provides fallback runtime database state when not passed', () => {
    render(
      <BusinessesProvider ui={uiComponents}>
        <DefaultDatabaseStateConsumer />
      </BusinessesProvider>
    );

    expect(screen.getByText('default-state')).toBeInTheDocument();
  });

  it('exposes passed runtime database state via context hooks', () => {
    render(
      <BusinessesProvider
        databaseState={providedDatabaseState}
        ui={uiComponents}
      >
        <ProvidedDatabaseStateConsumer />
      </BusinessesProvider>
    );

    expect(screen.getByText('provided-state')).toBeInTheDocument();
  });
});
