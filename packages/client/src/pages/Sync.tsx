import { LogOut } from 'lucide-react';
import { useCallback } from 'react';
import { LoginForm } from '@/components/auth';
import { SessionList } from '@/components/sessions';
import { BackLink } from '@/components/ui/back-link';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';

interface SyncProps {
  showBackLink?: boolean;
}

export function Sync({ showBackLink = true }: SyncProps) {
  const { isAuthenticated, user, isLoading, logout } = useAuth();

  const handleLogout = useCallback(() => {
    logout();
  }, [logout]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          {showBackLink && (
            <BackLink defaultTo="/" defaultLabel="Back to Home" />
          )}
          <h1 className="font-bold text-2xl tracking-tight">Sync</h1>
        </div>
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (isAuthenticated && user) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          {showBackLink && (
            <BackLink defaultTo="/" defaultLabel="Back to Home" />
          )}
          <h1 className="font-bold text-2xl tracking-tight">Sync</h1>
        </div>

        <div className="rounded-lg border p-4">
          <div className="space-y-4">
            <div>
              <p className="font-medium">Logged in as</p>
              <p className="text-muted-foreground text-sm">{user.email}</p>
            </div>

            <Button onClick={handleLogout} variant="outline" className="w-full">
              <LogOut className="mr-2 h-4 w-4" />
              Logout
            </Button>
          </div>
        </div>

        <div className="rounded-lg border p-4">
          <div className="space-y-4">
            <div>
              <p className="font-medium">Active Sessions</p>
              <p className="text-muted-foreground text-sm">
                Manage your active sessions across devices
              </p>
            </div>

            <SessionList />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        {showBackLink && <BackLink defaultTo="/" defaultLabel="Back to Home" />}
        <h1 className="font-bold text-2xl tracking-tight">Sync</h1>
      </div>

      <LoginForm
        title="Login"
        description="Sign in to sync your data across devices"
      />
    </div>
  );
}
