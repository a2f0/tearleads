import type { HostRuntimeDatabaseState } from '@tearleads/shared';
import {
  type ComponentType,
  createContext,
  type ReactNode,
  useContext
} from 'react';

export interface DropdownMenuProps {
  trigger: string;
  children: ReactNode;
}

export interface DropdownMenuItemProps {
  onClick: () => void;
  checked?: boolean;
  icon?: ReactNode;
  children: ReactNode;
}

export interface AboutMenuItemProps {
  appName: string;
  closeLabel: string;
}

export type DropdownMenuComponent = ComponentType<DropdownMenuProps>;
export type DropdownMenuItemComponent = ComponentType<DropdownMenuItemProps>;
export type AboutMenuItemComponent = ComponentType<AboutMenuItemProps>;

export interface BusinessesUIComponents {
  DropdownMenu: DropdownMenuComponent;
  DropdownMenuItem: DropdownMenuItemComponent;
  AboutMenuItem: AboutMenuItemComponent;
}

export type BusinessesDatabaseState = HostRuntimeDatabaseState;

interface BusinessesContextValue {
  databaseState: BusinessesDatabaseState;
  ui: BusinessesUIComponents;
}

const BusinessesContext = createContext<BusinessesContextValue | null>(null);

const FALLBACK_DATABASE_STATE: BusinessesDatabaseState = {
  isUnlocked: true,
  isLoading: false,
  currentInstanceId: null
};

export interface BusinessesProviderProps {
  children: ReactNode;
  databaseState?: BusinessesDatabaseState;
  ui: BusinessesUIComponents;
}

export function BusinessesProvider({
  children,
  databaseState,
  ui
}: BusinessesProviderProps) {
  return (
    <BusinessesContext.Provider
      value={{
        databaseState: databaseState ?? FALLBACK_DATABASE_STATE,
        ui
      }}
    >
      {children}
    </BusinessesContext.Provider>
  );
}

export function useBusinesses(): BusinessesContextValue {
  const context = useContext(BusinessesContext);
  if (!context) {
    throw new Error(
      'Businesses context is not available. Ensure BusinessesProvider is configured.'
    );
  }
  return context;
}

export function useBusinessesDatabaseState(): BusinessesDatabaseState {
  const { databaseState } = useBusinesses();
  return databaseState;
}
