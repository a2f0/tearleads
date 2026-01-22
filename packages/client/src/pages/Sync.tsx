import { LogOut } from 'lucide-react';
import { useCallback, useState } from 'react';
import { BackLink } from '@/components/ui/back-link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/AuthContext';

interface SyncProps {
  showBackLink?: boolean;
}

export function Sync({ showBackLink = true }: SyncProps) {
  const { isAuthenticated, user, isLoading, login, logout } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      setIsSubmitting(true);

      try {
        await login(email, password);
        // Clear form on success
        setEmail('');
        setPassword('');
      } catch (err) {
        setError(
          typeof err === 'string'
            ? err
            : err instanceof Error
              ? err.message
              : 'Login failed. Please try again.'
        );
      } finally {
        setIsSubmitting(false);
      }
    },
    [email, password, login]
  );

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
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        {showBackLink && <BackLink defaultTo="/" defaultLabel="Back to Home" />}
        <h1 className="font-bold text-2xl tracking-tight">Sync</h1>
      </div>

      <div className="rounded-lg border p-4">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <p className="font-medium">Login</p>
            <p className="text-muted-foreground text-sm">
              Sign in to sync your data across devices
            </p>
          </div>

          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-destructive text-sm">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <label htmlFor="email" className="font-medium text-sm">
              Email
            </label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              disabled={isSubmitting}
              autoComplete="email"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="password" className="font-medium text-sm">
              Password
            </label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              required
              disabled={isSubmitting}
              autoComplete="current-password"
            />
          </div>

          <Button
            type="submit"
            disabled={isSubmitting || !email || !password}
            className="w-full"
          >
            {isSubmitting ? 'Signing in...' : 'Sign In'}
          </Button>
        </form>
      </div>
    </div>
  );
}
