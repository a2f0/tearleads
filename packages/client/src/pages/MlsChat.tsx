/**
 * MLS Chat page wrapper.
 * Provides the MlsChatProvider with app-specific dependencies and UI components.
 */

import { API_BASE_URL } from '@tearleads/api-client';
import {
  MlsChat as MlsChatComponent,
  MlsChatProvider,
  type MlsChatUIComponents
} from '@tearleads/mls-chat';
import { type FC, useCallback } from 'react';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/AuthContext';
import { useDatabaseContext } from '@/db/hooks';

// Map our UI components to what MlsChat expects
const MlsChatButton: MlsChatUIComponents['Button'] = ({
  onClick,
  children,
  disabled,
  variant,
  size,
  className
}) => (
  <Button
    onClick={onClick}
    disabled={disabled}
    variant={variant}
    size={size}
    className={className}
  >
    {children}
  </Button>
);

const MlsChatInput: MlsChatUIComponents['Input'] = ({
  value,
  onChange,
  placeholder,
  disabled,
  className
}) => (
  <Input
    value={value}
    onChange={(e) => onChange(e.target.value)}
    placeholder={placeholder}
    disabled={disabled}
    className={className}
  />
);

const MlsChatAvatar: MlsChatUIComponents['Avatar'] = ({
  userId,
  email,
  size,
  className
}) => {
  const sizeClasses = {
    sm: 'h-8 w-8',
    md: 'h-10 w-10',
    lg: 'h-12 w-12'
  };

  const initials = email
    ? (email.split('@')[0]?.charAt(0)?.toUpperCase() ?? '?')
    : userId.charAt(0).toUpperCase();

  return (
    <div
      className={`flex items-center justify-center rounded-full bg-muted ${sizeClasses[size ?? 'md']} ${className ?? ''}`}
    >
      <span className="font-medium text-sm">{initials}</span>
    </div>
  );
};

const MlsChatScrollArea: MlsChatUIComponents['ScrollArea'] = ({
  children,
  className
}) => <div className={`overflow-auto ${className ?? ''}`}>{children}</div>;

const MlsChatDropdownMenu: MlsChatUIComponents['DropdownMenu'] = ({
  trigger,
  children,
  align
}) => (
  <DropdownMenu trigger={trigger} {...(align !== undefined && { align })}>
    {children}
  </DropdownMenu>
);

const MlsChatDropdownMenuItem: MlsChatUIComponents['DropdownMenuItem'] = ({
  onClick,
  icon,
  children
}) => (
  <DropdownMenuItem onClick={onClick} icon={icon}>
    {children}
  </DropdownMenuItem>
);

const uiComponents: MlsChatUIComponents = {
  Button: MlsChatButton,
  Input: MlsChatInput,
  Avatar: MlsChatAvatar,
  ScrollArea: MlsChatScrollArea,
  DropdownMenu: MlsChatDropdownMenu,
  DropdownMenuItem: MlsChatDropdownMenuItem
};

interface MlsChatPageProps {
  className?: string;
}

export const MlsChatPage: FC<MlsChatPageProps> = ({ className }) => {
  const { isUnlocked, isLoading: isDatabaseLoading } = useDatabaseContext();
  const { token, user } = useAuth();

  // Get the API base URL from environment
  const apiBaseUrl = API_BASE_URL ?? 'http://localhost:5001/v1';

  // Auth header function - stabilize reference to prevent downstream hooks from re-creating
  const getAuthHeader = useCallback(
    () => (token ? `Bearer ${token}` : null),
    [token]
  );

  // User info
  const userId = user?.id ?? '';
  const userEmail = user?.email ?? '';

  if (isDatabaseLoading) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border p-8 text-center text-muted-foreground">
        Loading database...
      </div>
    );
  }

  if (!isUnlocked) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <InlineUnlock description="MLS chat" />
      </div>
    );
  }

  if (!userId || !userEmail) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Please log in to use MLS Chat</p>
      </div>
    );
  }

  return (
    <MlsChatProvider
      apiBaseUrl={apiBaseUrl}
      getAuthHeader={getAuthHeader}
      userId={userId}
      userEmail={userEmail}
      ui={uiComponents}
    >
      <MlsChatComponent className={className ?? ''} />
    </MlsChatProvider>
  );
};

export { MlsChatPage as MlsChat };
