/**
 * Test utilities for MLS chat components.
 * Provides mock providers and helper functions.
 */

import { type RenderOptions, render } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';

import {
  MlsChatProvider,
  type MlsChatUIComponents
} from '../context/MlsChatContext.js';

// Mock UI components for testing
const MockButton: MlsChatUIComponents['Button'] = ({
  onClick,
  children,
  disabled,
  className
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={className}
  >
    {children}
  </button>
);

const MockInput: MlsChatUIComponents['Input'] = ({
  value,
  onChange,
  placeholder,
  disabled,
  className
}) => (
  <input
    type="text"
    value={value}
    onChange={(e) => onChange(e.target.value)}
    placeholder={placeholder}
    disabled={disabled}
    className={className}
  />
);

const MockAvatar: MlsChatUIComponents['Avatar'] = ({
  userId,
  email,
  className
}) => (
  <div className={className} data-testid="avatar" data-user-id={userId}>
    {email?.charAt(0) ?? userId.charAt(0)}
  </div>
);

const MockScrollArea: MlsChatUIComponents['ScrollArea'] = ({
  children,
  className
}) => <div className={className}>{children}</div>;

const MockDropdownMenu: MlsChatUIComponents['DropdownMenu'] = ({
  trigger,
  children
}) => (
  <div data-testid="dropdown">
    {trigger}
    <div data-testid="dropdown-content">{children}</div>
  </div>
);

const MockDropdownMenuItem: MlsChatUIComponents['DropdownMenuItem'] = ({
  onClick,
  icon,
  children
}) => (
  <button type="button" onClick={onClick} data-testid="dropdown-item">
    {icon}
    {children}
  </button>
);

const mockUiComponents: MlsChatUIComponents = {
  Button: MockButton,
  Input: MockInput,
  Avatar: MockAvatar,
  ScrollArea: MockScrollArea,
  DropdownMenu: MockDropdownMenu,
  DropdownMenuItem: MockDropdownMenuItem
};

interface TestProviderProps {
  children: ReactNode;
  apiBaseUrl?: string;
  getAuthHeader?: () => string | null;
  userId?: string;
  userEmail?: string;
  ui?: Partial<MlsChatUIComponents>;
}

function TestMlsChatProvider({
  children,
  apiBaseUrl = 'http://localhost:3000',
  getAuthHeader = () => 'Bearer test-token',
  userId = 'test-user-id',
  userEmail = 'test@example.com',
  ui = {}
}: TestProviderProps): ReactElement {
  return (
    <MlsChatProvider
      apiBaseUrl={apiBaseUrl}
      getAuthHeader={getAuthHeader}
      userId={userId}
      userEmail={userEmail}
      ui={{ ...mockUiComponents, ...ui }}
    >
      {children}
    </MlsChatProvider>
  );
}

interface CustomRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  providerProps?: Omit<TestProviderProps, 'children'>;
}

export function renderWithProvider(
  ui: ReactElement,
  { providerProps = {}, ...renderOptions }: CustomRenderOptions = {}
): ReturnType<typeof render> {
  function Wrapper({ children }: { children: ReactNode }): ReactElement {
    return (
      <TestMlsChatProvider {...providerProps}>{children}</TestMlsChatProvider>
    );
  }

  return render(ui, { wrapper: Wrapper, ...renderOptions });
}

// Re-export testing library utilities
export * from '@testing-library/react';
export { renderWithProvider as render };
