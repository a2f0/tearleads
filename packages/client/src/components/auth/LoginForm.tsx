import { useCallback, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/AuthContext';

/** Delay before scrolling input into view, allowing keyboard to fully appear */
const SCROLL_INTO_VIEW_DELAY_MS = 300;

/**
 * Scroll an input element into view after keyboard appears.
 * Uses a delay to allow the keyboard to fully open and viewport to resize.
 */
function scrollInputIntoView(element: HTMLInputElement) {
  // Delay to let keyboard fully appear and viewport resize
  setTimeout(() => {
    // Check if scrollIntoView is available (not in jsdom test environment)
    if (typeof element.scrollIntoView === 'function') {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, SCROLL_INTO_VIEW_DELAY_MS);
}

interface LoginFormProps {
  /** Title displayed above the form */
  title?: string;
  /** Description text displayed below the title */
  description?: string;
  /** Optional CTA to switch auth modes (e.g., create account) */
  switchModeCta?:
    | {
        prompt: string;
        actionLabel: string;
        onAction: () => void;
      }
    | undefined;
}

export function LoginForm({
  title = 'Login',
  description = 'Sign in to continue',
  switchModeCta
}: LoginFormProps) {
  const id = useId();
  const { authError, clearAuthError, login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const handleInputFocus = useCallback(
    (ref: React.RefObject<HTMLInputElement | null>) => {
      if (ref.current) {
        scrollInputIntoView(ref.current);
      }
    },
    []
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      clearAuthError();
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
    [email, password, login, clearAuthError]
  );

  return (
    <div className="rounded-lg border p-4">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <p className="font-medium">{title}</p>
          <p className="text-muted-foreground text-sm">{description}</p>
        </div>

        {authError && (
          <div className="rounded-md bg-destructive/10 p-3 text-destructive text-sm">
            {authError}
          </div>
        )}

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
            ref={emailRef}
            id={`${id}-email`}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onFocus={() => handleInputFocus(emailRef)}
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
            ref={passwordRef}
            id={`${id}-password`}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onFocus={() => handleInputFocus(passwordRef)}
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

        {switchModeCta ? (
          <div className="text-center text-muted-foreground text-sm">
            {switchModeCta.prompt}{' '}
            <button
              type="button"
              onClick={switchModeCta.onAction}
              className="font-medium text-primary hover:underline"
            >
              {switchModeCta.actionLabel}
            </button>
          </div>
        ) : null}
      </form>
    </div>
  );
}
