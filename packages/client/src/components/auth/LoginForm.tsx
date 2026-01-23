import { useCallback, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/AuthContext';

interface LoginFormProps {
  /** Title displayed above the form */
  title?: string;
  /** Description text displayed below the title */
  description?: string;
}

export function LoginForm({
  title = 'Login',
  description = 'Sign in to continue'
}: LoginFormProps) {
  const id = useId();
  const { login } = useAuth();
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

  return (
    <div className="rounded-lg border p-4">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <p className="font-medium">{title}</p>
          <p className="text-muted-foreground text-sm">{description}</p>
        </div>

        {error && (
          <div className="rounded-md bg-destructive/10 p-3 text-destructive text-sm">
            {error}
          </div>
        )}

        <div className="space-y-2">
          <label htmlFor={`${id}-email`} className="font-medium text-sm">
            Email
          </label>
          <Input
            id={`${id}-email`}
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
          <label htmlFor={`${id}-password`} className="font-medium text-sm">
            Password
          </label>
          <Input
            id={`${id}-password`}
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
  );
}
