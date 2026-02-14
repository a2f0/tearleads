import { BackLink } from '@/components/ui/back-link';
import { OpfsBrowser } from './OpfsBrowser';

interface OpfsProps {
  showBackLink?: boolean;
  backTo?: string;
  backLabel?: string;
}

export function Opfs({
  showBackLink = false,
  backTo = '/',
  backLabel = 'Back to Home'
}: OpfsProps) {
  return (
    <div className="space-y-6">
      {showBackLink && <BackLink defaultTo={backTo} defaultLabel={backLabel} />}
      <OpfsBrowser />
    </div>
  );
}
