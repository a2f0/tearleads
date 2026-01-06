import { ArrowLeft } from 'lucide-react';
import { Link, type LinkProps, useLocation } from 'react-router-dom';

interface BackLinkState {
  from?: string;
  fromLabel?: string;
}

interface BackLinkProps {
  defaultTo: string;
  defaultLabel: string;
}

export function BackLink({ defaultTo, defaultLabel }: BackLinkProps) {
  const location = useLocation();
  const state = location.state as BackLinkState | null;

  const to = state?.from ?? defaultTo;
  const label = state?.fromLabel ?? defaultLabel;

  return (
    <Link
      to={to}
      className="inline-flex items-center text-muted-foreground hover:text-foreground"
      data-testid="back-link"
    >
      <ArrowLeft className="mr-2 h-4 w-4" />
      {label}
    </Link>
  );
}

interface LinkWithFromProps extends Omit<LinkProps, 'state'> {
  fromLabel?: string;
}

export function LinkWithFrom({
  fromLabel,
  to,
  children,
  ...props
}: LinkWithFromProps) {
  const location = useLocation();

  return (
    <Link
      to={to}
      state={{
        from: location.pathname,
        fromLabel
      }}
      {...props}
    >
      {children}
    </Link>
  );
}
