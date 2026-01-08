import { ArrowLeft } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';

interface BackLinkProps {
  defaultTo: string;
  defaultLabel: string;
}

export function BackLink({ defaultTo, defaultLabel }: BackLinkProps) {
  const location = useLocation();
  const state = location.state as {
    from?: unknown;
    fromLabel?: unknown;
  } | null;

  const to = typeof state?.from === 'string' ? state.from : defaultTo;
  const label =
    typeof state?.fromLabel === 'string' ? state.fromLabel : defaultLabel;

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
