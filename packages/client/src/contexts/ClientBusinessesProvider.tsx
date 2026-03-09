// one-component-per-file: allow
/**
 * Client-side BusinessesProvider wrapper that supplies all dependencies
 * to the @tearleads/app-businesses package components.
 */

import {
  type AboutMenuItemProps,
  BusinessesProvider,
  type BusinessesUIComponents
} from '@tearleads/app-businesses';
import businessesPackageJson from '@tearleads/app-businesses/package.json';
import type { ReactNode } from 'react';
import { DropdownMenu, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { AboutMenuItem } from '@/components/window-menu/AboutMenuItem';
import { useHostRuntimeDatabaseState } from '@/db/hooks';

function BusinessesAboutMenuItem(props: AboutMenuItemProps) {
  return <AboutMenuItem {...props} version={businessesPackageJson.version} />;
}

const businessesUIComponents: BusinessesUIComponents = {
  DropdownMenu,
  DropdownMenuItem,
  AboutMenuItem: BusinessesAboutMenuItem
};

interface ClientBusinessesProviderProps {
  children: ReactNode;
}

export function ClientBusinessesProvider({
  children
}: ClientBusinessesProviderProps) {
  const databaseState = useHostRuntimeDatabaseState();

  return (
    <BusinessesProvider databaseState={databaseState} ui={businessesUIComponents}>
      {children}
    </BusinessesProvider>
  );
}
