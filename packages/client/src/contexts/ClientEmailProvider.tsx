import { EmailProvider, type EmailUIComponents } from '@rapid/email';
import type { ReactNode } from 'react';
import { BackLink } from '@/components/ui/back-link';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu';
import { RefreshButton } from '@/components/ui/refresh-button';
import { AboutMenuItem } from '@/components/window-menu/AboutMenuItem';
import { WindowOptionsMenuItem } from '@/components/window-menu/WindowOptionsMenuItem';
import { API_BASE_URL } from '@/lib/api';
import { getAuthHeaderValue } from '@/lib/auth-storage';

const emailUIComponents: EmailUIComponents = {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
  WindowOptionsMenuItem,
  AboutMenuItem,
  BackLink,
  RefreshButton
};

interface ClientEmailProviderProps {
  children: ReactNode;
}

export function ClientEmailProvider({ children }: ClientEmailProviderProps) {
  if (!API_BASE_URL) {
    throw new Error('VITE_API_URL environment variable is not set');
  }

  return (
    <EmailProvider
      apiBaseUrl={API_BASE_URL}
      getAuthHeader={getAuthHeaderValue}
      ui={emailUIComponents}
    >
      {children}
    </EmailProvider>
  );
}
