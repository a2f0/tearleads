import type { ReactNode } from 'react';
import {
  type EmailContactOperations,
  type EmailFolderOperations,
  EmailProvider,
  type EmailUIComponents
} from '../context';

const mockUIComponents: EmailUIComponents = {
  DropdownMenu: ({ trigger, children }) => (
    <div data-testid={`dropdown-${trigger}`}>
      <button type="button" data-testid={`trigger-${trigger}`}>
        {trigger}
      </button>
      <div data-testid={`menu-${trigger}`}>{children}</div>
    </div>
  ),
  DropdownMenuItem: ({ children, onClick, checked }) => (
    <button
      type="button"
      onClick={onClick}
      data-checked={checked}
      data-testid={`menuitem-${children}`}
    >
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <hr data-testid="separator" />,
  WindowOptionsMenuItem: () => <div data-testid="window-options" />,
  AboutMenuItem: () => <div data-testid="about-menu-item" />,
  BackLink: ({ defaultLabel }) => (
    <a href="/" data-testid="back-link">
      {defaultLabel}
    </a>
  ),
  RefreshButton: ({ onClick, loading }) => (
    <button
      type="button"
      onClick={onClick}
      data-testid="refresh-button"
      data-loading={loading}
    >
      Refresh
    </button>
  )
};

interface TestEmailProviderProps {
  children: ReactNode;
  apiBaseUrl?: string;
  getAuthHeader?: () => string | null;
  ui?: EmailUIComponents;
  contactOperations?: EmailContactOperations;
  folderOperations?: EmailFolderOperations;
}

export function TestEmailProvider({
  children,
  apiBaseUrl = 'http://localhost:5001/v1',
  getAuthHeader,
  ui = mockUIComponents,
  contactOperations,
  folderOperations
}: TestEmailProviderProps) {
  return (
    <EmailProvider
      apiBaseUrl={apiBaseUrl}
      ui={ui}
      {...(getAuthHeader !== undefined && { getAuthHeader })}
      {...(contactOperations !== undefined && { contactOperations })}
      {...(folderOperations !== undefined && { folderOperations })}
    >
      {children}
    </EmailProvider>
  );
}
