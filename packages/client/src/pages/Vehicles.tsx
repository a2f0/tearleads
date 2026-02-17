import { VehiclesPage } from '@tearleads/vehicles';
import { BackLink } from '@/components/ui/back-link';
import { VehiclesManager } from '@/components/vehicles';

interface VehiclesProps {
  showBackLink?: boolean;
}

export function Vehicles({ showBackLink = true }: VehiclesProps) {
  return (
    <VehiclesPage
      backLink={
        showBackLink ? (
          <BackLink defaultTo="/" defaultLabel="Back to Home" />
        ) : null
      }
    >
      <VehiclesManager />
    </VehiclesPage>
  );
}
