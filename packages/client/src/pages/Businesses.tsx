import { BusinessesManager, BusinessesPage } from '@tearleads/businesses';
import { BackLink } from '@/components/ui/back-link';

export function Businesses() {
  return (
    <BusinessesPage
      backLink={<BackLink defaultTo="/" defaultLabel="Back to Home" />}
    >
      <BusinessesManager />
    </BusinessesPage>
  );
}
