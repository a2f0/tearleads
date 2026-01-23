import type { ReactNode } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { LoginForm } from './LoginForm';

interface RequireAuthProps {
  children: ReactNode;
  /** Title shown in the login prompt */
  loginTitle?: string;
  /** Description shown in the login prompt */
  loginDescription?: string;
}

export function RequireAuth({
  children,
  loginTitle = 'Authentication Required',
  loginDescription = 'Please sign in to access this page'
}: RequireAuthProps) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="p-8 text-center text-muted-foreground">Loading...</div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="p-4">
        <LoginForm title={loginTitle} description={loginDescription} />
      </div>
    );
  }

  return <>{children}</>;
}
