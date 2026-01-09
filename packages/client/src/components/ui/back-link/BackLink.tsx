import { isRecord } from '@rapid/shared';
import { ArrowLeft } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';

interface BackLinkProps {
  defaultTo: string;
  defaultLabel: string;
}

export function BackLink({ defaultTo, defaultLabel }: BackLinkProps) {
  const location = useLocation();
  const state = location.state;
  const from = isRecord(state) ? state['from'] : undefined;
  const fromLabel = isRecord(state) ? state['fromLabel'] : undefined;
  const to = typeof from === 'string' ? from : defaultTo;
  const label = typeof fromLabel === 'string' ? fromLabel : defaultLabel;

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
