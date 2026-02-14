/**
 * Inline login component that displays a login form.
 * Used on pages that require authentication when the user is not logged in.
 * Styled to match InlineUnlock for visual consistency.
 */

import { User } from 'lucide-react';
import { LoginForm } from './LoginForm';

interface InlineLoginProps {
  /** Description of what will be accessible after logging in */
  description?: string;
}

export function InlineLogin({
  description = 'this feature'
}: InlineLoginProps) {
  return (
    <div data-testid="inline-login">
      <div className="mb-4 text-center">
        <User className="mx-auto h-12 w-12 text-muted-foreground/50" />
        <p className="mt-4 text-muted-foreground">
          Sign in required to access {description}.
        </p>
      </div>

      <LoginForm
        title="Sign In"
        description={`Please sign in to continue to ${description}`}
      />
    </div>
  );
}
