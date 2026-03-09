import { VehiclesPage } from '@tearleads/app-vehicles';
import { BackLink } from '@/components/ui/back-link';
import { VehiclesManager } from '@/components/vehicles';
import { ClientVehiclesProvider } from '@/contexts/ClientVehiclesProvider';

interface VehiclesProps {
  showBackLink?: boolean;
}

export function Vehicles({ showBackLink = true }: VehiclesProps) {
  return (
    <ClientVehiclesProvider>
      <VehiclesPage
        backLink={
          showBackLink ? (
            <BackLink defaultTo="/" defaultLabel="Back to Home" />
          ) : null
        }
      >
        <VehiclesManager />
      </VehiclesPage>
    </ClientVehiclesProvider>
  );
}
