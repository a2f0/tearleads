/**
 * Client-side BusinessesProvider wrapper that supplies all dependencies
 * to the @tearleads/businesses package components.
 */

import {
  BusinessesProvider,
  type BusinessesUIComponents
} from '@tearleads/businesses';
import businessesPackageJson from '@tearleads/businesses/package.json';
import type { ReactNode } from 'react';
import { DropdownMenu, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { AboutMenuItem } from '@/components/window-menu/AboutMenuItem';

function BusinessesAboutMenuItem() {
  return (
    <AboutMenuItem
      appName="Businesses"
      version={businessesPackageJson.version}
      closeLabel="Close"
    />
  );
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
  return (
    <BusinessesProvider ui={businessesUIComponents}>
      {children}
    </BusinessesProvider>
  );
}
