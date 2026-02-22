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

interface BusinessesContextValue {
  ui: BusinessesUIComponents;
}

const BusinessesContext = createContext<BusinessesContextValue | null>(null);

export interface BusinessesProviderProps {
  children: ReactNode;
  ui: BusinessesUIComponents;
}

export function BusinessesProvider({ children, ui }: BusinessesProviderProps) {
  return (
    <BusinessesContext.Provider value={{ ui }}>
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
