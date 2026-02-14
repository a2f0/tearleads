import { BackLink } from '@/components/ui/back-link';
import { VehiclesManager } from '@/components/vehicles';

interface VehiclesProps {
  showBackLink?: boolean;
}

export function Vehicles({ showBackLink = true }: VehiclesProps) {
  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden">
      <div className="flex flex-col gap-2 pb-4">
        {showBackLink ? (
          <BackLink defaultTo="/" defaultLabel="Back to Home" />
        ) : null}
        <h1 className="font-bold text-xl tracking-tight sm:text-2xl">
          Vehicles
        </h1>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border p-3">
        <VehiclesManager />
      </div>
    </div>
  );
}
