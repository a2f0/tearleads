import { renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import {
  type BusinessesDatabaseState,
  BusinessesProvider,
  type BusinessesUIComponents,
  useBusinesses,
  useBusinessesDatabaseState
} from './BusinessesContext.js';

const uiComponents: BusinessesUIComponents = {
  DropdownMenu: () => null,
  DropdownMenuItem: () => null,
  AboutMenuItem: () => null
};

const defaultDatabaseState: BusinessesDatabaseState = {
  isUnlocked: true,
  isLoading: false,
  currentInstanceId: null
};

const providedDatabaseState: BusinessesDatabaseState = {
  isUnlocked: false,
  isLoading: true,
  currentInstanceId: 'instance-42'
};

function createWrapper(databaseState: BusinessesDatabaseState = defaultDatabaseState) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(BusinessesProvider, {
      children,
      databaseState,
      ui: uiComponents
    });
  };
}

describe('BusinessesContext', () => {
  it('provides ui components through BusinessesProvider', () => {
    const { result } = renderHook(() => useBusinesses(), {
      wrapper: createWrapper()
    });
    expect(result.current.ui).toBe(uiComponents);
  });

  it('throws when useBusinesses is used outside the provider', () => {
    expect(() => renderHook(() => useBusinesses())).toThrow(
      'Businesses context is not available. Ensure BusinessesProvider is configured.'
    );
  });

  it('exposes passed runtime database state via context hooks', () => {
    const { result } = renderHook(() => useBusinessesDatabaseState(), {
      wrapper: createWrapper(providedDatabaseState)
    });
    expect(result.current).toEqual(providedDatabaseState);
  });
});
