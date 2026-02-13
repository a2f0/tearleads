import { BusinessesManager } from '@/components/businesses';
import { BackLink } from '@/components/ui/back-link';

export function Businesses() {
  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden">
      <div className="flex flex-col gap-2 pb-4">
        <BackLink defaultTo="/" defaultLabel="Back to Home" />
        <h1 className="font-bold text-xl tracking-tight sm:text-2xl">
          Businesses
        </h1>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border p-3">
        <BusinessesManager />
      </div>
    </div>
  );
}
