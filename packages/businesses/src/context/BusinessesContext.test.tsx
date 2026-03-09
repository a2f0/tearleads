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

const providedDatabaseState: BusinessesDatabaseState = {
  isUnlocked: false,
  isLoading: true,
  currentInstanceId: 'instance-42'
};

function createWrapper(databaseState?: BusinessesDatabaseState) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      BusinessesProvider,
      { databaseState, ui: uiComponents },
      children
    );
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

  it('provides fallback runtime database state when not passed', () => {
    const { result } = renderHook(() => useBusinessesDatabaseState(), {
      wrapper: createWrapper()
    });
    expect(result.current.currentInstanceId).toBeNull();
    expect(result.current.isUnlocked).toBe(true);
    expect(result.current.isLoading).toBe(false);
  });

  it('exposes passed runtime database state via context hooks', () => {
    const { result } = renderHook(() => useBusinessesDatabaseState(), {
      wrapper: createWrapper(providedDatabaseState)
    });
    expect(result.current).toEqual(providedDatabaseState);
  });
});
